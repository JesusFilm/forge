import { createHmac } from "node:crypto"

import type { ConsumerLifecycleOutbox, PrismaClient } from "@/generated/prisma"

const DEFAULT_BATCH_SIZE = 50
const MAX_BATCH_SIZE = 100
const LEASE_MS = 30_000
const MAX_ATTEMPTS = 12
const DELIVERY_TIMEOUT_MS = 5_000

export type ConsumerLifecycleDelivery = Pick<
  ConsumerLifecycleOutbox,
  "id" | "ownerSubject" | "state" | "version" | "activeLeaseExpiresAt"
>

export interface ConsumerLifecycleSender {
  send(event: ConsumerLifecycleDelivery): Promise<void>
}

export class ConsumerLifecycleDeliveryError extends Error {
  constructor(readonly code: string) {
    super("Consumer lifecycle delivery failed.")
    this.name = "ConsumerLifecycleDeliveryError"
  }
}

export class SignedConsumerLifecycleSender implements ConsumerLifecycleSender {
  private readonly fetchImpl: typeof fetch
  private readonly now: () => Date

  constructor(
    private readonly options: {
      endpoint: string
      secret: string
      fetchImpl?: typeof fetch
      now?: () => Date
    },
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? (() => new Date())
  }

  async send(event: ConsumerLifecycleDelivery): Promise<void> {
    const body = JSON.stringify({
      ownerSubject: event.ownerSubject,
      state: event.state,
      version: event.version.toString(),
      sourceEventId: event.id,
      activeLeaseExpiresAt: event.activeLeaseExpiresAt?.toISOString() ?? null,
    })
    const timestamp = String(this.now().getTime())
    const signature = createHmac("sha256", this.options.secret)
      .update(`${timestamp}.${body}`)
      .digest("hex")

    let response: Response
    try {
      response = await this.fetchImpl(this.options.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forge-lifecycle-timestamp": timestamp,
          "x-forge-lifecycle-signature": `v1=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      })
    } catch {
      throw new ConsumerLifecycleDeliveryError("network")
    }
    if (!response.ok) {
      throw new ConsumerLifecycleDeliveryError(`http_${response.status}`)
    }
  }
}

export class ConsumerLifecycleOutboxService {
  private readonly now: () => Date

  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: ConsumerLifecycleSender & { now?: () => Date },
  ) {
    this.now = options.now ?? (() => new Date())
  }

  async deliverBatch(
    workerId: string,
    limit = DEFAULT_BATCH_SIZE,
  ): Promise<{ delivered: number; failed: number }> {
    const rows = await this.leaseBatch(workerId, limit)
    let delivered = 0
    let failed = 0
    for (const row of rows) {
      try {
        await this.options.send(row)
        await this.prisma.consumerLifecycleOutbox.updateMany({
          where: { id: row.id, leaseOwner: workerId, status: "LEASED" },
          data: {
            status: "DELIVERED",
            deliveredAt: this.now(),
            leaseOwner: null,
            leaseExpiresAt: null,
            lastErrorCode: null,
          },
        })
        delivered += 1
      } catch (error) {
        const attempts = row.attempts + 1
        const dead = attempts >= MAX_ATTEMPTS
        await this.prisma.consumerLifecycleOutbox.updateMany({
          where: { id: row.id, leaseOwner: workerId, status: "LEASED" },
          data: {
            status: dead ? "DEAD" : "PENDING",
            attempts,
            nextAttemptAt: new Date(
              this.now().getTime() + retryDelayMs(attempts),
            ),
            leaseOwner: null,
            leaseExpiresAt: null,
            lastErrorCode:
              error instanceof ConsumerLifecycleDeliveryError
                ? error.code
                : "unknown",
          },
        })
        failed += 1
      }
    }
    return { delivered, failed }
  }

  private async leaseBatch(workerId: string, requestedLimit: number) {
    const now = this.now()
    const limit = Math.min(Math.max(requestedLimit, 1), MAX_BATCH_SIZE)
    return this.prisma.$transaction(async (tx) => {
      const candidates = await tx.consumerLifecycleOutbox.findMany({
        where: {
          OR: [
            { status: "PENDING", nextAttemptAt: { lte: now } },
            { status: "LEASED", leaseExpiresAt: { lte: now } },
          ],
        },
        orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
        take: limit,
      })
      const leased: ConsumerLifecycleOutbox[] = []
      for (const candidate of candidates) {
        const acquired = await tx.consumerLifecycleOutbox.updateMany({
          where: {
            id: candidate.id,
            OR: [
              { status: "PENDING", nextAttemptAt: { lte: now } },
              { status: "LEASED", leaseExpiresAt: { lte: now } },
            ],
          },
          data: {
            status: "LEASED",
            leaseOwner: workerId,
            leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
          },
        })
        if (acquired.count === 1) leased.push(candidate)
      }
      return leased
    })
  }
}

function retryDelayMs(attempts: number): number {
  return Math.min(1_000 * 2 ** Math.min(attempts, 8), 5 * 60_000)
}

import { createHmac } from "node:crypto"

import type { ConsumerLifecycleOutbox, PrismaClient } from "@/generated/prisma"

const DEFAULT_BATCH_SIZE = 50
const MAX_BATCH_SIZE = 100
const MAX_CANDIDATE_SCAN = 500
const LEASE_MS = 30_000
const MAX_ATTEMPTS = 12
const DELIVERY_TIMEOUT_MS = 5_000
const LEASE_CONFLICT_RETRIES = 3

export type ConsumerLifecycleDelivery = Pick<
  ConsumerLifecycleOutbox,
  "id" | "ownerSubject" | "state" | "version" | "activeLeaseExpiresAt"
>

export interface ConsumerLifecycleSender {
  send(event: ConsumerLifecycleDelivery): Promise<void>
}

export type ConsumerLifecycleOutboxHealth = {
  pending: number
  leased: number
  dead: number
  due: number
  backlog: number
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
    const boundedLimit = Math.min(
      Math.max(Math.trunc(limit), 1),
      MAX_BATCH_SIZE,
    )
    let delivered = 0
    let failed = 0
    for (let index = 0; index < boundedLimit; index += 1) {
      // Claim immediately before delivery. The production sender has a
      // five-second timeout, comfortably inside the 30-second ownership
      // lease, so no row waits in a worker-local queue while its lease ages.
      const row = await this.leaseNext(workerId)
      if (!row) break
      try {
        await this.options.send(row)
        const acknowledged =
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
        if (acknowledged.count === 1) delivered += 1
      } catch (error) {
        const attempts = row.attempts + 1
        const dead = attempts >= MAX_ATTEMPTS
        const requeued = await this.prisma.consumerLifecycleOutbox.updateMany({
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
        if (requeued.count === 1) failed += 1
      }
    }
    return { delivered, failed }
  }

  async getHealth(): Promise<ConsumerLifecycleOutboxHealth> {
    const now = this.now()
    const [pending, leased, dead, due] = await Promise.all([
      this.prisma.consumerLifecycleOutbox.count({
        where: { status: "PENDING" },
      }),
      this.prisma.consumerLifecycleOutbox.count({
        where: { status: "LEASED" },
      }),
      this.prisma.consumerLifecycleOutbox.count({ where: { status: "DEAD" } }),
      this.prisma.consumerLifecycleOutbox.count({
        where: {
          OR: [
            { status: "PENDING", nextAttemptAt: { lte: now } },
            { status: "LEASED", leaseExpiresAt: { lte: now } },
          ],
        },
      }),
    ])
    return { pending, leased, dead, due, backlog: pending + leased + dead }
  }

  private async leaseNext(workerId: string) {
    let lastConflict: unknown
    for (let attempt = 0; attempt < LEASE_CONFLICT_RETRIES; attempt += 1) {
      try {
        return await this.tryLeaseNext(workerId)
      } catch (error) {
        if (!isPrismaWriteConflict(error)) throw error
        lastConflict = error
      }
    }
    throw lastConflict
  }

  private async tryLeaseNext(workerId: string) {
    const now = this.now()
    return this.prisma.$transaction(
      async (tx) => {
        let cursor: string | undefined
        for (;;) {
          const candidates = await tx.consumerLifecycleOutbox.findMany({
            where: {
              OR: [
                { status: "PENDING", nextAttemptAt: { lte: now } },
                { status: "LEASED", leaseExpiresAt: { lte: now } },
              ],
            },
            orderBy: [
              { nextAttemptAt: "asc" },
              { createdAt: "asc" },
              { id: "asc" },
            ],
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            take: MAX_CANDIDATE_SCAN,
          })
          for (const candidate of candidates) {
            // A later lifecycle version must not overtake an earlier version
            // for the same owner, including one in retry or DEAD.
            const earlierOutstanding =
              await tx.consumerLifecycleOutbox.findFirst({
                where: {
                  ownerSubject: candidate.ownerSubject,
                  version: { lt: candidate.version },
                  status: { not: "DELIVERED" },
                },
                select: { id: true },
              })
            if (earlierOutstanding) continue

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
            if (acquired.count === 1) return candidate
          }

          if (candidates.length < MAX_CANDIDATE_SCAN) return null
          cursor = candidates.at(-1)?.id
          if (!cursor) return null
        }
      },
      { isolationLevel: "Serializable" },
    )
  }
}

function isPrismaWriteConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2034"
  )
}

function retryDelayMs(attempts: number): number {
  return Math.min(1_000 * 2 ** Math.min(attempts, 8), 5 * 60_000)
}

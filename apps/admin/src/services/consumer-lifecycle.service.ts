import type { ConsumerLifecycleState, PrismaClient } from "@prisma/client"

const MAX_ACTIVE_LEASE_MS = 5 * 60_000
const SUBJECT_PATTERN = /^[^\s]{1,255}$/
const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export class ConsumerLifecycleUnavailableError extends Error {
  constructor(message = "Consumer lifecycle is unavailable") {
    super(message)
    this.name = "ConsumerLifecycleUnavailableError"
  }
}

export class ConsumerLifecycleEventConflictError extends Error {
  constructor(message = "Invalid or conflicting consumer lifecycle event") {
    super(message)
    this.name = "ConsumerLifecycleEventConflictError"
  }
}

export type ConsumerLifecycleEvent = {
  ownerSubject: string
  state: ConsumerLifecycleState
  version: bigint
  sourceEventId: string
  activeLeaseExpiresAt: Date | null
}

export type ConsumerLifecycleApplyResult = {
  applied: boolean
  replayed: boolean
  stale: boolean
}

type LifecycleOptions = {
  now?: () => Date
  erasedSubjectDigest?: (ownerSubject: string) => Uint8Array
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime()
}

function identical(
  stored: ConsumerLifecycleEvent,
  event: ConsumerLifecycleEvent,
): boolean {
  return (
    stored.ownerSubject === event.ownerSubject &&
    stored.state === event.state &&
    stored.version === event.version &&
    stored.sourceEventId === event.sourceEventId &&
    sameInstant(stored.activeLeaseExpiresAt, event.activeLeaseExpiresAt)
  )
}

export class ConsumerLifecycleService {
  private readonly now: () => Date

  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: LifecycleOptions = {},
  ) {
    this.now = options.now ?? (() => new Date())
  }

  private validate(event: ConsumerLifecycleEvent): void {
    if (
      !SUBJECT_PATTERN.test(event.ownerSubject) ||
      !EVENT_ID_PATTERN.test(event.sourceEventId) ||
      event.version < 0n
    ) {
      throw new ConsumerLifecycleEventConflictError()
    }
    const nowMs = this.now().getTime()
    if (event.state === "ACTIVE") {
      const expiryMs = event.activeLeaseExpiresAt?.getTime() ?? Number.NaN
      if (
        !Number.isFinite(expiryMs) ||
        expiryMs <= nowMs ||
        expiryMs > nowMs + MAX_ACTIVE_LEASE_MS
      ) {
        throw new ConsumerLifecycleEventConflictError(
          "ACTIVE lifecycle events require a future lease of at most five minutes",
        )
      }
    } else if (event.activeLeaseExpiresAt !== null) {
      throw new ConsumerLifecycleEventConflictError(
        "Only ACTIVE lifecycle events may carry a lease",
      )
    }
  }

  async apply(
    event: ConsumerLifecycleEvent,
  ): Promise<ConsumerLifecycleApplyResult> {
    this.validate(event)
    return this.prisma.$transaction(async (tx) => {
      if (this.options.erasedSubjectDigest) {
        const erased = await tx.userPlaylistErasureReceipt.findFirst({
          where: {
            ownerSubjectDigest: Buffer.from(
              this.options.erasedSubjectDigest(event.ownerSubject),
            ),
          },
          select: { id: true },
        })
        if (erased) throw new ConsumerLifecycleUnavailableError()
      }

      const current = await tx.consumerLifecycleProjection.findUnique({
        where: { ownerSubject: event.ownerSubject },
      })
      if (current) {
        const stored: ConsumerLifecycleEvent = {
          ownerSubject: current.ownerSubject,
          state: current.state,
          version: current.version,
          sourceEventId: current.sourceEventId,
          activeLeaseExpiresAt: current.activeLeaseExpiresAt,
        }
        if (event.version < current.version) {
          return { applied: false, replayed: false, stale: true }
        }
        if (event.version === current.version) {
          if (!identical(stored, event)) {
            throw new ConsumerLifecycleEventConflictError()
          }
          return { applied: false, replayed: true, stale: false }
        }

        const updated = await tx.consumerLifecycleProjection.updateMany({
          where: {
            ownerSubject: event.ownerSubject,
            version: { lt: event.version },
          },
          data: {
            state: event.state,
            version: event.version,
            sourceEventId: event.sourceEventId,
            activeLeaseExpiresAt: event.activeLeaseExpiresAt,
          },
        })
        if (updated.count === 1) {
          return { applied: true, replayed: false, stale: false }
        }

        const winner = await tx.consumerLifecycleProjection.findUniqueOrThrow({
          where: { ownerSubject: event.ownerSubject },
        })
        if (winner.version > event.version) {
          return { applied: false, replayed: false, stale: true }
        }
        if (
          winner.version === event.version &&
          identical(
            {
              ownerSubject: winner.ownerSubject,
              state: winner.state,
              version: winner.version,
              sourceEventId: winner.sourceEventId,
              activeLeaseExpiresAt: winner.activeLeaseExpiresAt,
            },
            event,
          )
        ) {
          return { applied: false, replayed: true, stale: false }
        }
        throw new ConsumerLifecycleEventConflictError()
      }

      await tx.consumerLifecycleProjection.create({ data: event })
      return { applied: true, replayed: false, stale: false }
    })
  }

  async assertActive(ownerSubject: string): Promise<void> {
    const projection = await this.prisma.consumerLifecycleProjection.findUnique(
      {
        where: { ownerSubject },
        select: { state: true, activeLeaseExpiresAt: true },
      },
    )
    const nowMs = this.now().getTime()
    const expiryMs = projection?.activeLeaseExpiresAt?.getTime() ?? Number.NaN
    if (
      projection?.state !== "ACTIVE" ||
      !Number.isFinite(expiryMs) ||
      expiryMs <= nowMs ||
      expiryMs > nowMs + MAX_ACTIVE_LEASE_MS
    ) {
      throw new ConsumerLifecycleUnavailableError()
    }
  }

  async listProjections(ownerSubjects: readonly string[]) {
    return this.prisma.consumerLifecycleProjection.findMany({
      where: { ownerSubject: { in: [...new Set(ownerSubjects)] } },
      orderBy: { ownerSubject: "asc" },
    })
  }
}

export interface ConsumerLifecycleBootstrapSource {
  nextBatch(input: {
    cursor: string | null
    limit: number
  }): Promise<{ events: ConsumerLifecycleEvent[]; nextCursor: string | null }>
}

export class ConsumerLifecycleReconciliationService {
  constructor(
    private readonly lifecycle: ConsumerLifecycleService,
    private readonly source: ConsumerLifecycleBootstrapSource,
  ) {}

  async reconcileBatch(input: { cursor?: string | null; limit?: number }) {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500)
    const batch = await this.source.nextBatch({
      cursor: input.cursor ?? null,
      limit,
    })
    const results = []
    for (const event of batch.events)
      results.push(await this.lifecycle.apply(event))
    return { ...batch, results }
  }
}

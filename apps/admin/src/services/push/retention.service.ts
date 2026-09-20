import {
  Prisma,
  PushRegistrationStatus,
  WorkflowRunStatus,
  type PrismaClient,
} from "@prisma/client"

import { PushInputError } from "./errors"

export const PUSH_RETENTION_BATCH_SIZE = 5_000
export const PUSH_RETENTION_MAX_BATCH_SIZE = 20_000
/** Per-phone rows are personal data; they live 90 days and no longer. */
export const PUSH_ROW_RETENTION_DAYS = 90
/** A phone that has not refreshed in 180 days is treated as an abandoned install. */
export const PUSH_REGISTRATION_INACTIVE_DAYS = 180
/** A retired registration holds a push token, so it is deleted, not kept. */
export const PUSH_REGISTRATION_DELETE_DAYS = 90
export const PUSH_RETENTION_PROPAGATION_HOURS = 24
export const PUSH_RETENTION_HEALTH_HOURS = 36
export const PUSH_RETENTION_WORKFLOW_KEY = "push-retention"

// Own lock id in the retention namespace: 368_000_001 is the recommendation
// purge, 002 its scheduler, 003 the episode recovery runner.
const PUSH_RETENTION_LOCK_ID = 368_000_004

const RETIRED_REGISTRATION_STATUSES = [
  PushRegistrationStatus.INACTIVE,
  PushRegistrationStatus.INVALID,
  PushRegistrationStatus.SUPERSEDED,
]

export type PushPurgeResult = Readonly<{
  status: "succeeded" | "skipped"
  rowCounts: Record<string, number>
  oldestExpiredAtAfter: string | null
  overdueAfterRun: boolean
}>

export type PushRetentionHealth = Readonly<{
  healthy: boolean
  reason: "healthy" | "retention_overdue" | "missing_success_watermark"
  latestSuccessAt: Date | null
  oldestOverdueAt: Date | null
}>

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

function hoursBefore(now: Date, hours: number): Date {
  return new Date(now.getTime() - hours * 60 * 60 * 1000)
}

function earliestDate(values: Array<Date | null | undefined>): Date | null {
  return values.reduce<Date | null>((oldest, candidate) => {
    if (!candidate) return oldest
    return !oldest || candidate < oldest ? candidate : oldest
  }, null)
}

/**
 * Purges one bounded page of expired push rows and retires stale phones.
 *
 * Its own advisory lock and its own ledger key keep it clear of the
 * recommendation privacy purge: a push failure never retries that purge, and
 * a slow push page never holds the recommendation transaction open.
 */
export async function purgeExpiredPushRows(
  prisma: PrismaClient,
  now: Date = new Date(),
  batchSize = PUSH_RETENTION_BATCH_SIZE,
): Promise<PushPurgeResult> {
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > PUSH_RETENTION_MAX_BATCH_SIZE
  ) {
    throw new PushInputError("Push retention batch size is invalid")
  }
  const rowCutoff = daysBefore(now, PUSH_ROW_RETENTION_DAYS)
  const refreshCutoff = daysBefore(now, PUSH_REGISTRATION_INACTIVE_DAYS)
  const retiredCutoff = daysBefore(now, PUSH_REGISTRATION_DELETE_DAYS)
  // Each delegate needs its own literal so Prisma keeps the row type; the
  // three pages are otherwise identical.
  const expiredPage = () => ({
    where: { createdAt: { lte: rowCutoff } },
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    take: batchSize,
    select: { id: true as const },
  })
  const oldestExpired = () => ({
    where: { createdAt: { lte: rowCutoff } },
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    select: { createdAt: true as const },
  })

  return prisma.$transaction(async (tx): Promise<PushPurgeResult> => {
    const lock = await tx.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`
      SELECT pg_try_advisory_xact_lock(${PUSH_RETENTION_LOCK_ID}) AS locked
    `)
    if (!lock[0]?.locked) {
      return {
        status: "skipped",
        rowCounts: {},
        oldestExpiredAtAfter: null,
        overdueAfterRun: false,
      }
    }

    // Children first. A delivery delete cascades to its open, and the open
    // resolves nothing without it, so the delivery page runs last.
    const attributions = await tx.pushAttribution.findMany(expiredPage())
    const expiredAttributions =
      attributions.length === 0
        ? 0
        : (
            await tx.pushAttribution.deleteMany({
              where: { id: { in: attributions.map(({ id }) => id) } },
            })
          ).count
    const opens = await tx.pushOpen.findMany(expiredPage())
    const expiredOpens =
      opens.length === 0
        ? 0
        : (
            await tx.pushOpen.deleteMany({
              where: { id: { in: opens.map(({ id }) => id) } },
            })
          ).count
    const deliveries = await tx.pushDelivery.findMany(expiredPage())
    const expiredDeliveries =
      deliveries.length === 0
        ? 0
        : (
            await tx.pushDelivery.deleteMany({
              where: { id: { in: deliveries.map(({ id }) => id) } },
            })
          ).count

    const stale = await tx.pushRegistration.findMany({
      where: {
        status: PushRegistrationStatus.ACTIVE,
        refreshedAt: { lte: refreshCutoff },
      },
      orderBy: [{ refreshedAt: "asc" }, { id: "asc" }],
      take: batchSize,
      select: { id: true },
    })
    const registrationsMarkedInactive =
      stale.length === 0
        ? 0
        : (
            await tx.pushRegistration.updateMany({
              where: {
                id: { in: stale.map(({ id }) => id) },
                status: PushRegistrationStatus.ACTIVE,
                refreshedAt: { lte: refreshCutoff },
              },
              data: {
                status: PushRegistrationStatus.INACTIVE,
                statusChangedAt: now,
              },
            })
          ).count
    const retired = await tx.pushRegistration.findMany({
      where: {
        status: { in: RETIRED_REGISTRATION_STATUSES },
        statusChangedAt: { lte: retiredCutoff },
      },
      orderBy: [{ statusChangedAt: "asc" }, { id: "asc" }],
      take: batchSize,
      select: { id: true },
    })
    const retiredRegistrationsDeleted =
      retired.length === 0
        ? 0
        : (
            await tx.pushRegistration.deleteMany({
              where: { id: { in: retired.map(({ id }) => id) } },
            })
          ).count

    const [oldestAttribution, oldestOpen, oldestDelivery] = await Promise.all([
      tx.pushAttribution.findFirst(oldestExpired()),
      tx.pushOpen.findFirst(oldestExpired()),
      tx.pushDelivery.findFirst(oldestExpired()),
    ])
    const oldestExpiredAt = earliestDate([
      oldestAttribution?.createdAt,
      oldestOpen?.createdAt,
      oldestDelivery?.createdAt,
    ])

    return {
      status: "succeeded",
      rowCounts: {
        expiredAttributions,
        expiredOpens,
        expiredDeliveries,
        registrationsMarkedInactive,
        retiredRegistrationsDeleted,
      },
      oldestExpiredAtAfter: oldestExpiredAt?.toISOString() ?? null,
      overdueAfterRun: oldestExpiredAt != null,
    }
  })
}

/**
 * Reads the push purge's own health. It never joins the recommendation health
 * read: a push backlog must not gate recommendation delivery.
 */
export async function readPushRetentionHealth(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<PushRetentionHealth> {
  const overdueCutoff = hoursBefore(
    daysBefore(now, PUSH_ROW_RETENTION_DAYS),
    PUSH_RETENTION_PROPAGATION_HOURS,
  )
  const freshnessCutoff = hoursBefore(now, PUSH_RETENTION_HEALTH_HOURS)
  const overdue = () => ({
    where: { createdAt: { lte: overdueCutoff } },
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    select: { createdAt: true as const },
  })
  const [latestRun, oldestDelivery, oldestOpen, oldestAttribution] =
    await Promise.all([
      prisma.workflowRun.findFirst({
        where: {
          workflowKey: PUSH_RETENTION_WORKFLOW_KEY,
          status: WorkflowRunStatus.SUCCEEDED,
        },
        orderBy: { finishedAt: "desc" },
        select: { finishedAt: true },
      }),
      prisma.pushDelivery.findFirst(overdue()),
      prisma.pushOpen.findFirst(overdue()),
      prisma.pushAttribution.findFirst(overdue()),
    ])
  const latestSuccessAt = latestRun?.finishedAt ?? null
  const oldestOverdueAt = earliestDate([
    oldestDelivery?.createdAt,
    oldestOpen?.createdAt,
    oldestAttribution?.createdAt,
  ])
  if (oldestOverdueAt) {
    return {
      healthy: false,
      reason: "retention_overdue",
      latestSuccessAt,
      oldestOverdueAt,
    }
  }
  if (latestSuccessAt == null || latestSuccessAt < freshnessCutoff) {
    return {
      healthy: false,
      reason: "missing_success_watermark",
      latestSuccessAt,
      oldestOverdueAt: null,
    }
  }
  return {
    healthy: true,
    reason: "healthy",
    latestSuccessAt,
    oldestOverdueAt: null,
  }
}

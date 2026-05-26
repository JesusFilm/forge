import { WorkflowRunStatus, type PrismaClient } from "@prisma/client"
import { env } from "@/config/env"

export const SEARCH_TRACE_RETENTION_WORKFLOW_KEY = "search-trace-retention"
export const SEARCH_TRACE_RETENTION_SCHEDULER_WORKFLOW_KEY =
  "search-trace-retention-scheduler"
export const SEARCH_TRACE_RETENTION_HEALTH_WINDOW_MS = 36 * 60 * 60 * 1000

export type SearchTracePurgeResult = {
  purgedCount: number
  purgedBefore: string
}

export type SearchTraceRetentionHealth = {
  healthy: boolean
  reason: "not-production" | "scheduler-active" | "recent-purge" | "missing"
  latestPurgeAt: string | null
  activeSchedulerRunId: string | null
}

function toIsoOrNull(value: Date | null | undefined): string | null {
  return value == null ? null : value.toISOString()
}

export function isSearchTraceRetentionSchedulerFresh(
  scheduler: { updatedAt?: Date | null; createdAt?: Date | null },
  now: Date = new Date(),
): boolean {
  const heartbeatAt = scheduler.updatedAt ?? scheduler.createdAt ?? null
  if (heartbeatAt == null) return false
  const ageMs = now.getTime() - heartbeatAt.getTime()
  return ageMs >= 0 && ageMs <= SEARCH_TRACE_RETENTION_HEALTH_WINDOW_MS
}

export async function purgeExpiredSearchTraces(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<SearchTracePurgeResult> {
  const result = await prisma.searchTrace.deleteMany({
    where: {
      rawExpiresAt: {
        lte: now,
      },
    },
  })

  return {
    purgedCount: result.count,
    purgedBefore: now.toISOString(),
  }
}

export async function readSearchTraceRetentionHealth(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<SearchTraceRetentionHealth> {
  if (env.NODE_ENV !== "production") {
    return {
      healthy: true,
      reason: "not-production",
      latestPurgeAt: null,
      activeSchedulerRunId: null,
    }
  }

  const activeScheduler = await prisma.workflowRun.findFirst({
    where: {
      workflowKey: SEARCH_TRACE_RETENTION_SCHEDULER_WORKFLOW_KEY,
      status: {
        in: [WorkflowRunStatus.QUEUED, WorkflowRunStatus.RUNNING],
      },
    },
    orderBy: { updatedAt: "desc" },
  })

  if (
    activeScheduler &&
    isSearchTraceRetentionSchedulerFresh(activeScheduler, now)
  ) {
    return {
      healthy: true,
      reason: "scheduler-active",
      latestPurgeAt: null,
      activeSchedulerRunId: activeScheduler.id,
    }
  }

  const latestPurge = await prisma.workflowRun.findFirst({
    where: {
      workflowKey: SEARCH_TRACE_RETENTION_WORKFLOW_KEY,
      status: WorkflowRunStatus.SUCCEEDED,
    },
    orderBy: { finishedAt: "desc" },
  })
  const latestPurgeAt =
    latestPurge?.finishedAt ?? latestPurge?.updatedAt ?? null
  const latestPurgeAgeMs =
    latestPurgeAt == null
      ? Number.POSITIVE_INFINITY
      : now.getTime() - latestPurgeAt.getTime()

  if (latestPurgeAgeMs <= SEARCH_TRACE_RETENTION_HEALTH_WINDOW_MS) {
    return {
      healthy: true,
      reason: "recent-purge",
      latestPurgeAt: toIsoOrNull(latestPurgeAt),
      activeSchedulerRunId: null,
    }
  }

  return {
    healthy: false,
    reason: "missing",
    latestPurgeAt: toIsoOrNull(latestPurgeAt),
    activeSchedulerRunId: null,
  }
}

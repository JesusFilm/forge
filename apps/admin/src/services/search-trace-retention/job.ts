import { Prisma, WorkflowRunStatus } from "@prisma/client"
import { start } from "workflow/api"
import { prisma } from "@/db/client"
import {
  attachWorkflowRuntimeRunId,
  createWorkflowRunLog,
  markWorkflowRunFailed,
  markWorkflowRunStarted,
} from "@/services/workflow-run-log.service"
import {
  isSearchTraceRetentionSchedulerFresh,
  purgeExpiredSearchTraces,
} from "@/services/search-trace-retention.service"
import {
  runSearchTraceRetention,
  runSearchTraceRetentionScheduler,
} from "@/workflows/searchTraceRetention"

export type SearchTraceRetentionTrigger = "scheduled"
export type SearchTraceRetentionSchedulerInput = {
  ledgerRunId?: string
}

export type SearchTraceRetentionWorkflowInput = {
  trigger?: SearchTraceRetentionTrigger
  ledgerRunId?: string
}

export type SearchTraceRetentionJobResult = {
  purgedCount: number
  purgedRawTraceCount: number
  purgedGeneratedCandidateCount: number
  purgedWatchSearchEventCount: number
  purgedQueryEmbeddingCacheCount: number
  purgedBefore: string
}

export type SearchTraceRetentionDispatchResult = {
  workflow: "search-trace-retention"
  runId: string
  trigger: SearchTraceRetentionTrigger
  status: "queued"
}

export type SearchTraceRetentionSchedulerStartResult =
  | {
      started: true
      runId: string
      ledgerRunId: string
    }
  | {
      started: false
      reason: "already-running" | "lock-not-acquired"
      ledgerRunId?: string
      runtimeRunId?: string | null
    }

const SCHEDULER_WORKFLOW_KEY = "search-trace-retention-scheduler"
const SCHEDULER_LOCK_ID = 136_000_021
const PURGE_HOUR_UTC = 10

export function nextSearchTraceRetentionRunAt(
  now: Date = new Date(),
  hourUtc = PURGE_HOUR_UTC,
): Date {
  const next = new Date(now)
  next.setUTCHours(hourUtc, 0, 0, 0)
  if (next <= now) {
    next.setUTCDate(next.getUTCDate() + 1)
  }
  return next
}

export async function dispatchSearchTraceRetention(
  input: SearchTraceRetentionWorkflowInput = {},
): Promise<SearchTraceRetentionDispatchResult> {
  const trigger = input.trigger ?? "scheduled"
  const ledgerRun = await createWorkflowRunLog({
    workflowKey: "search-trace-retention",
    workflowName: "Search Trace Retention",
    trigger,
    subjectType: "search-trace",
    subjectId: "raw",
    summary: "Search trace retention workflow queued.",
    details: {
      retention: "raw-search-traces",
    },
  })

  try {
    const run = await start(runSearchTraceRetention, [
      { trigger, ledgerRunId: ledgerRun.id },
    ])
    await attachWorkflowRuntimeRunId(ledgerRun.id, run.runId)

    return {
      workflow: "search-trace-retention",
      runId: run.runId,
      trigger,
      status: "queued",
    }
  } catch (error) {
    await markWorkflowRunFailed(ledgerRun.id, error).catch(() => {})
    throw error
  }
}

export async function runSearchTraceRetentionJob(
  input: SearchTraceRetentionWorkflowInput = {},
): Promise<SearchTraceRetentionJobResult> {
  const startedAt = Date.now()
  if (input.ledgerRunId) {
    await markWorkflowRunStarted(input.ledgerRunId)
  }

  try {
    const result = await purgeExpiredSearchTraces(prisma)

    if (input.ledgerRunId) {
      await prisma.workflowRun.update({
        where: { id: input.ledgerRunId },
        data: {
          status: WorkflowRunStatus.SUCCEEDED,
          summary: `Purged ${result.purgedCount} expired search trace artifact(s).`,
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt,
          details: {
            purgedCount: result.purgedCount,
            purgedRawTraceCount: result.purgedRawTraceCount,
            purgedGeneratedCandidateCount: result.purgedGeneratedCandidateCount,
            purgedWatchSearchEventCount: result.purgedWatchSearchEventCount,
            purgedQueryEmbeddingCacheCount:
              result.purgedQueryEmbeddingCacheCount,
            purgedBefore: result.purgedBefore,
          } satisfies Prisma.InputJsonValue,
        },
      })
    }

    return result
  } catch (error) {
    if (input.ledgerRunId) {
      await markWorkflowRunFailed(input.ledgerRunId, error).catch(() => {})
    }
    throw error
  }
}

export async function runSearchTraceRetentionFromScheduler(): Promise<{
  ok: boolean
  ledgerRunId: string
  result?: SearchTraceRetentionJobResult
  error?: string
}> {
  const ledgerRun = await createWorkflowRunLog({
    workflowKey: "search-trace-retention",
    workflowName: "Search Trace Retention",
    trigger: "scheduled",
    subjectType: "search-trace",
    subjectId: "raw",
    summary: "Search trace retention workflow started by scheduler.",
    details: {
      retention: "raw-search-traces",
    },
  })

  try {
    const result = await runSearchTraceRetentionJob({
      trigger: "scheduled",
      ledgerRunId: ledgerRun.id,
    })
    return { ok: true, ledgerRunId: ledgerRun.id, result }
  } catch (error) {
    return {
      ok: false,
      ledgerRunId: ledgerRun.id,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function markSearchTraceRetentionSchedulerStarted(
  input: SearchTraceRetentionSchedulerInput = {},
): Promise<void> {
  if (!input.ledgerRunId) return
  await markWorkflowRunStarted(input.ledgerRunId)
}

export async function recordSearchTraceRetentionSchedulerHeartbeat(
  input: SearchTraceRetentionSchedulerInput,
  nextRunAt: Date,
): Promise<void> {
  if (!input.ledgerRunId) return
  await prisma.workflowRun.update({
    where: { id: input.ledgerRunId },
    data: {
      summary: `Search trace retention scheduler sleeping until ${nextRunAt.toISOString()}.`,
      details: {
        nextRunAt: nextRunAt.toISOString(),
        schedule: `daily ${String(PURGE_HOUR_UTC).padStart(2, "0")}:00 UTC`,
      } satisfies Prisma.InputJsonValue,
    },
  })
}

async function withSchedulerStartLock<T>(
  callback: () => Promise<T>,
): Promise<T> {
  const rows = await prisma.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(${SCHEDULER_LOCK_ID}) AS locked
  `
  if (!rows[0]?.locked) {
    return {
      started: false,
      reason: "lock-not-acquired",
    } as T
  }

  try {
    return await callback()
  } finally {
    await prisma.$queryRaw`
      SELECT pg_advisory_unlock(${SCHEDULER_LOCK_ID})
    `
  }
}

export async function ensureSearchTraceRetentionSchedulerStarted(): Promise<SearchTraceRetentionSchedulerStartResult> {
  return withSchedulerStartLock(async () => {
    const existing = await prisma.workflowRun.findFirst({
      where: {
        workflowKey: SCHEDULER_WORKFLOW_KEY,
        status: {
          in: [WorkflowRunStatus.QUEUED, WorkflowRunStatus.RUNNING],
        },
      },
      orderBy: { createdAt: "desc" },
    })

    if (existing && isSearchTraceRetentionSchedulerFresh(existing)) {
      return {
        started: false,
        reason: "already-running",
        ledgerRunId: existing.id,
        runtimeRunId: existing.runtimeRunId,
      }
    }
    if (existing) {
      await prisma.workflowRun.update({
        where: { id: existing.id },
        data: {
          status: WorkflowRunStatus.FAILED,
          finishedAt: new Date(),
          summary:
            "Search trace retention scheduler stale; starting a replacement.",
          error: "scheduler_stale",
        },
      })
    }

    const ledgerRun = await createWorkflowRunLog({
      workflowKey: SCHEDULER_WORKFLOW_KEY,
      workflowName: "Search Trace Retention Scheduler",
      trigger: "system",
      subjectType: "search-trace",
      subjectId: "raw",
      summary: "Search trace retention scheduler queued.",
      details: {
        schedule: `daily ${String(PURGE_HOUR_UTC).padStart(2, "0")}:00 UTC`,
      },
    })

    try {
      const run = await start(runSearchTraceRetentionScheduler, [
        { ledgerRunId: ledgerRun.id },
      ])
      await attachWorkflowRuntimeRunId(ledgerRun.id, run.runId)
      return {
        started: true,
        runId: run.runId,
        ledgerRunId: ledgerRun.id,
      }
    } catch (error) {
      await markWorkflowRunFailed(ledgerRun.id, error).catch(() => {})
      throw error
    }
  })
}

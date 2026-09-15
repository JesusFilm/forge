import { type Prisma, WorkflowRunStatus } from "@prisma/client"
import type { WorkflowRunStatus as RuntimeWorkflowRunStatus } from "@workflow/world"
import { start } from "workflow/api"
import { getWorld } from "workflow/runtime"
import { prisma } from "@/db/client"
import {
  attachWorkflowRuntimeRunId,
  createWorkflowRunLog,
  markWorkflowRunFailed,
  markWorkflowRunStarted,
} from "@/services/workflow-run-log.service"
import {
  purgeExpiredRecommendationRequests,
  RECOMMENDATION_RETENTION_HEALTH_HOURS,
  type RecommendationPurgeResult,
} from "../retention.service"
import { RecommendationInternalStateError } from "../errors"
import { runRecommendationRetentionScheduler } from "@/workflows/recommendationRetention"

export const RECOMMENDATION_RETENTION_SCHEDULER_WORKFLOW_KEY =
  "recommendation-retention-scheduler"
const RECOMMENDATION_RETENTION_PURGE_WORKFLOW_KEY = "recommendation-retention"
const RECOMMENDATION_RETENTION_SCHEDULER_LOCK_ID = 368_000_002
const PURGE_HOUR_UTC = 10
const RUNTIME_STATUS_LOOKUP_DEADLINE_MS = 1_000
const CATCH_UP_CONTINUATION_DELAY_MS = 60_000

const RUNTIME_TO_LEDGER_STATUS: Readonly<
  Record<RuntimeWorkflowRunStatus, WorkflowRunStatus | null>
> = {
  pending: null,
  running: null,
  completed: WorkflowRunStatus.SUCCEEDED,
  failed: WorkflowRunStatus.FAILED,
  cancelled: WorkflowRunStatus.CANCELLED,
}

type RuntimeRunStatus = {
  status: RuntimeWorkflowRunStatus
  error: string | null
}

async function loadRuntimeRunStatus(
  runtimeRunId: string,
): Promise<RuntimeRunStatus | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const run = await Promise.race([
      getWorld().runs.get(runtimeRunId, { resolveData: "none" }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("workflow runtime lookup timed out")),
          RUNTIME_STATUS_LOOKUP_DEADLINE_MS,
        )
      }),
    ])
    return {
      status: run.status,
      error: run.error?.message ?? null,
    }
  } catch {
    // The Workflow world may use a separate database or be temporarily
    // unavailable. In either case, preserve the active public ledger instead
    // of risking a duplicate scheduler or aborting Admin startup.
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function reconcileTerminalSchedulerRuntime(
  tx: Prisma.TransactionClient,
  existing: { id: string; runtimeRunId: string | null },
  runtimeRun: RuntimeRunStatus,
): Promise<boolean> {
  if (!existing.runtimeRunId) return false

  const ledgerStatus = RUNTIME_TO_LEDGER_STATUS[runtimeRun.status]
  if (!ledgerStatus) return false

  await tx.workflowRun.update({
    where: { id: existing.id },
    data: {
      status: ledgerStatus,
      summary: `Recommendation retention scheduler runtime ${runtimeRun.status}.`,
      error: runtimeRun.error,
      finishedAt: new Date(),
    },
  })
  return true
}

export function nextRecommendationRetentionRunAt(now: Date = new Date()): Date {
  const next = new Date(now)
  next.setUTCHours(PURGE_HOUR_UTC, 30, 0, 0)
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
  return next
}

export function nextRecommendationRetentionCatchUpRunAt(
  now: Date = new Date(),
): Date {
  return new Date(now.getTime() + CATCH_UP_CONTINUATION_DELAY_MS)
}

export async function runRecommendationRetentionJob(
  input: {
    ledgerRunId?: string
  } = {},
): Promise<RecommendationPurgeResult> {
  if (input.ledgerRunId) await markWorkflowRunStarted(input.ledgerRunId)
  try {
    const result = await purgeExpiredRecommendationRequests(prisma)
    if (input.ledgerRunId) {
      await prisma.workflowRun.update({
        where: { id: input.ledgerRunId },
        data: {
          status: WorkflowRunStatus.SUCCEEDED,
          summary: `Purged ${result.rootsDeleted} recommendation request root(s).`,
          finishedAt: new Date(),
          details: {
            rootsDeleted: result.rootsDeleted,
            overdueAfterRun: result.overdueAfterRun,
          },
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

export async function runRecommendationRetentionFromScheduler(): Promise<{
  ok: boolean
  ledgerRunId: string
  result?: RecommendationPurgeResult
  error?: string
}> {
  const ledger = await createWorkflowRunLog({
    workflowKey: RECOMMENDATION_RETENTION_PURGE_WORKFLOW_KEY,
    workflowName: "Recommendation Retention",
    trigger: "scheduled",
    subjectType: "recommendation-request",
    subjectId: "expired-roots",
    summary: "Recommendation retention purge started by scheduler.",
    details: { retention: "recommendation-request-roots" },
  })
  try {
    const result = await runRecommendationRetentionJob({
      ledgerRunId: ledger.id,
    })
    return { ok: true, ledgerRunId: ledger.id, result }
  } catch (error) {
    return {
      ok: false,
      ledgerRunId: ledger.id,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function recordRecommendationRetentionSchedulerHeartbeat(
  ledgerRunId: string | undefined,
  nextRunAt: Date,
): Promise<void> {
  if (!ledgerRunId) return
  await prisma.workflowRun.update({
    where: { id: ledgerRunId },
    data: {
      summary: `Recommendation retention scheduler sleeping until ${nextRunAt.toISOString()}.`,
      details: {
        nextRunAt: nextRunAt.toISOString(),
        schedule: "daily 10:30 UTC",
      },
    },
  })
}

export async function recordRecommendationRetentionSchedulerCatchUpHeartbeat(
  ledgerRunId: string | undefined,
  nextRunAt: Date,
): Promise<void> {
  if (!ledgerRunId) return
  await prisma.workflowRun.update({
    where: { id: ledgerRunId },
    data: {
      summary: `Recommendation retention scheduler continuing backlog catch-up at ${nextRunAt.toISOString()}.`,
      details: {
        nextRunAt: nextRunAt.toISOString(),
        schedule: "bounded backlog catch-up",
      },
    },
  })
}

export async function markRecommendationRetentionSchedulerRuntimeStarted(
  ledgerRunId: string | undefined,
  runtimeRunId: string,
): Promise<void> {
  if (!ledgerRunId) return
  const updated = await prisma.workflowRun.updateMany({
    where: {
      id: ledgerRunId,
      workflowKey: RECOMMENDATION_RETENTION_SCHEDULER_WORKFLOW_KEY,
      status: { in: [WorkflowRunStatus.QUEUED, WorkflowRunStatus.RUNNING] },
    },
    data: {
      runtimeRunId,
      status: WorkflowRunStatus.RUNNING,
      startedAt: new Date(),
      summary: "Recommendation retention scheduler running.",
    },
  })
  if (updated.count !== 1) {
    throw new RecommendationInternalStateError(
      "retention_scheduler_ledger_unavailable",
    )
  }
}

export async function ensureRecommendationRetentionSchedulerStarted(): Promise<{
  started: boolean
  runId?: string
  ledgerRunId?: string
}> {
  const freshnessCutoff = new Date(
    Date.now() - RECOMMENDATION_RETENTION_HEALTH_HOURS * 60 * 60 * 1000,
  )
  const inspectedLedger = await prisma.workflowRun.findFirst({
    where: {
      workflowKey: RECOMMENDATION_RETENTION_SCHEDULER_WORKFLOW_KEY,
      status: { in: [WorkflowRunStatus.QUEUED, WorkflowRunStatus.RUNNING] },
      updatedAt: { gte: freshnessCutoff },
    },
    orderBy: { updatedAt: "desc" },
  })
  const inspectedRuntime = inspectedLedger?.runtimeRunId
    ? await loadRuntimeRunStatus(inspectedLedger.runtimeRunId)
    : null

  const reservation = await prisma.$transaction(async (tx) => {
    const lock = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(${RECOMMENDATION_RETENTION_SCHEDULER_LOCK_ID}) AS locked
    `
    if (!lock[0]?.locked) return { started: false as const }

    const existing = await tx.workflowRun.findFirst({
      where: {
        workflowKey: RECOMMENDATION_RETENTION_SCHEDULER_WORKFLOW_KEY,
        status: { in: [WorkflowRunStatus.QUEUED, WorkflowRunStatus.RUNNING] },
        updatedAt: { gte: freshnessCutoff },
      },
      orderBy: { updatedAt: "desc" },
    })
    if (existing) {
      const terminal =
        inspectedLedger?.id === existing.id &&
        inspectedLedger.runtimeRunId === existing.runtimeRunId &&
        inspectedRuntime != null
          ? await reconcileTerminalSchedulerRuntime(
              tx,
              existing,
              inspectedRuntime,
            )
          : false
      if (!terminal) {
        return {
          started: false as const,
          ledgerRunId: existing.id,
        }
      }
    }
    const ledger = await createWorkflowRunLog(
      {
        workflowKey: RECOMMENDATION_RETENTION_SCHEDULER_WORKFLOW_KEY,
        workflowName: "Recommendation Retention Scheduler",
        trigger: "scheduled",
        subjectType: "recommendation-request",
        subjectId: "scheduler",
        summary: "Recommendation retention scheduler queued.",
        details: { schedule: "daily 10:30 UTC" },
      },
      tx,
    )
    return { started: true as const, ledger }
  })

  if (!reservation.started) return reservation
  const { ledger } = reservation
  let runtime: Awaited<ReturnType<typeof start>>
  try {
    runtime = await start(runRecommendationRetentionScheduler, [
      { ledgerRunId: ledger.id },
    ])
  } catch (error) {
    await markWorkflowRunFailed(ledger.id, error).catch(() => {})
    throw error
  }
  try {
    await attachWorkflowRuntimeRunId(ledger.id, runtime.runId)
  } catch {
    // The durable runtime is already authoritative. Its first step repairs the
    // ledger attachment, so never mark a successfully dispatched infinite
    // scheduler failed or allow bootstrap to start a duplicate.
    console.warn(
      `[recommendations] event=retention_scheduler_attachment_pending ledger=${ledger.id} runtime=${runtime.runId}`,
    )
  }
  return { started: true, runId: runtime.runId, ledgerRunId: ledger.id }
}

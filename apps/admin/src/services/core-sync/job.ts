import { start } from "workflow/api"
import { Prisma, WorkflowRunStatus } from "@prisma/client"
import { prisma, syncPrisma } from "@/db/client"
import {
  abortSyncRun,
  finishSyncRun,
  runSyncPhase,
  runSync,
  resolveScope,
  startSyncRun,
  type PhaseResult,
  type SyncRunContext,
  type SyncResult,
} from "@/services/core-sync/orchestrator"
import type { SyncPhase } from "@/services/core-sync/types"
import {
  attachWorkflowRuntimeRunId,
  createWorkflowRunLog,
  markWorkflowRunFailed,
  markWorkflowRunStarted,
  recordCoreSyncPhaseProgress,
  recordCoreSyncRunResult,
} from "@/services/workflow-run-log.service"
import { runCoreSync, runCoreSyncScheduler } from "@/workflows/coreSync"

export type CoreSyncTrigger = "manual" | "scheduled" | "graphql"

export type CoreSyncWorkflowInput = {
  scope?: string | string[]
  incremental?: boolean
  trigger?: CoreSyncTrigger
  ledgerRunId?: string
}

export type CoreSyncSchedulerInput = {
  ledgerRunId?: string
}

export type CoreSyncJobInput = {
  scope: SyncPhase[]
  incremental: boolean
  trigger: CoreSyncTrigger
}

export type CoreSyncJobResult = SyncResult & {
  scope: SyncPhase[]
  trigger: CoreSyncTrigger
}

export type CoreSyncJobStart =
  | { skipped: true; result: CoreSyncJobResult }
  | {
      skipped: false
      run: SyncRunContext
      scope: SyncPhase[]
      incremental: boolean
      trigger: CoreSyncTrigger
      ledgerRunId?: string
    }

export type CoreSyncDispatchResult = {
  workflow: "core-sync"
  runId: string
  scope: SyncPhase[]
  incremental: boolean
  trigger: CoreSyncTrigger
  status: "queued"
}

export type CoreSyncSchedulerStartResult =
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

export type CoreSyncSchedulerRunResult =
  | {
      ok: true
      dispatch: CoreSyncDispatchResult
    }
  | {
      ok: false
      error: string
    }

const SCHEDULER_WORKFLOW_KEY = "core-sync-scheduler"
const SCHEDULER_LOCK_ID = 426_083_110
const CORE_SYNC_HOUR_UTC = 7
const TERMINAL_RUNTIME_STATUSES = new Set(["completed", "failed", "cancelled"])

type SchedulerLedgerRun = {
  id: string
  runtimeRunId: string | null
}

type RuntimeRunStatus = {
  status: string
  error: string | null
}

export function nextCoreSyncRunAt(
  now: Date = new Date(),
  hourUtc = CORE_SYNC_HOUR_UTC,
): Date {
  const next = new Date(now)
  next.setUTCHours(hourUtc, 0, 0, 0)
  if (next <= now) {
    next.setUTCDate(next.getUTCDate() + 1)
  }
  return next
}

export function normalizeCoreSyncInput(
  input: CoreSyncWorkflowInput = {},
): CoreSyncJobInput {
  return {
    scope: resolveScope(input.scope),
    incremental: input.incremental ?? true,
    trigger: input.trigger ?? "manual",
  }
}

export async function dispatchCoreSync(
  input: CoreSyncWorkflowInput = {},
): Promise<CoreSyncDispatchResult> {
  const normalized = normalizeCoreSyncInput(input)
  const ledgerRun = await createWorkflowRunLog({
    workflowKey: "core-sync",
    workflowName: "Core Sync",
    trigger: normalized.trigger,
    subjectType: "sync",
    subjectId: "core",
    summary: "Core Sync workflow queued.",
    details: {
      scope: normalized.scope,
      incremental: normalized.incremental,
    },
  })
  const runInput: CoreSyncWorkflowInput = {
    scope: normalized.scope,
    incremental: normalized.incremental,
    trigger: normalized.trigger,
    ledgerRunId: ledgerRun.id,
  }
  try {
    const run = await start(runCoreSync, [runInput])
    await attachWorkflowRuntimeRunId(ledgerRun.id, run.runId)

    return {
      workflow: "core-sync",
      runId: run.runId,
      scope: normalized.scope,
      incremental: normalized.incremental,
      trigger: normalized.trigger,
      status: "queued",
    }
  } catch (error) {
    await markWorkflowRunFailed(ledgerRun.id, error).catch(() => {})
    throw error
  }
}

export async function markCoreSyncSchedulerStarted(
  input: CoreSyncSchedulerInput = {},
): Promise<void> {
  if (!input.ledgerRunId) return
  await markWorkflowRunStarted(input.ledgerRunId)
}

export async function recordCoreSyncSchedulerHeartbeat(
  input: CoreSyncSchedulerInput,
  nextRunAt: Date,
): Promise<void> {
  if (!input.ledgerRunId) return
  await prisma.workflowRun.update({
    where: { id: input.ledgerRunId },
    data: {
      summary: `Core Sync scheduler sleeping until ${nextRunAt.toISOString()}.`,
      details: {
        nextRunAt: nextRunAt.toISOString(),
        schedule: `daily ${String(CORE_SYNC_HOUR_UTC).padStart(2, "0")}:00 UTC`,
        incremental: true,
      } satisfies Prisma.InputJsonValue,
    },
  })
}

export async function runCoreSyncFromScheduler(): Promise<CoreSyncSchedulerRunResult> {
  try {
    const dispatch = await dispatchCoreSync({
      incremental: true,
      trigger: "scheduled",
    })
    return { ok: true, dispatch }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
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

async function loadRuntimeRunStatus(
  runtimeRunId: string,
): Promise<RuntimeRunStatus | null> {
  try {
    const rows = await prisma.$queryRaw<RuntimeRunStatus[]>`
      SELECT status, error
      FROM workflow.workflow_runs
      WHERE id = ${runtimeRunId}
      LIMIT 1
    `
    return rows[0] ?? null
  } catch {
    return null
  }
}

async function reconcileStaleSchedulerRun(
  existing: SchedulerLedgerRun,
): Promise<boolean> {
  if (!existing.runtimeRunId) return false

  const runtimeRun = await loadRuntimeRunStatus(existing.runtimeRunId)
  if (!runtimeRun || !TERMINAL_RUNTIME_STATUSES.has(runtimeRun.status)) {
    return false
  }

  const status =
    runtimeRun.status === "completed"
      ? WorkflowRunStatus.SUCCEEDED
      : WorkflowRunStatus.FAILED
  const summary =
    runtimeRun.status === "completed"
      ? "Core Sync scheduler stopped after runtime completion."
      : `Core Sync scheduler runtime ${runtimeRun.status}.`

  await prisma.workflowRun.update({
    where: { id: existing.id },
    data: {
      status,
      finishedAt: new Date(),
      summary,
      error: runtimeRun.error,
    },
  })

  return true
}

export async function ensureCoreSyncSchedulerStarted(): Promise<CoreSyncSchedulerStartResult> {
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

    if (existing) {
      const stale = await reconcileStaleSchedulerRun(existing)
      if (!stale) {
        return {
          started: false,
          reason: "already-running",
          ledgerRunId: existing.id,
          runtimeRunId: existing.runtimeRunId,
        }
      }
    }

    const ledgerRun = await createWorkflowRunLog({
      workflowKey: SCHEDULER_WORKFLOW_KEY,
      workflowName: "Core Sync Scheduler",
      trigger: "system",
      subjectType: "sync",
      subjectId: "core",
      summary: "Core Sync scheduler queued.",
      details: {
        schedule: `daily ${String(CORE_SYNC_HOUR_UTC).padStart(2, "0")}:00 UTC`,
        incremental: true,
      },
    })

    try {
      const run = await start(runCoreSyncScheduler, [
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

export async function runCoreSyncJob(
  input: CoreSyncWorkflowInput = {},
): Promise<CoreSyncJobResult> {
  const normalized = normalizeCoreSyncInput(input)
  if (input.ledgerRunId) {
    await markWorkflowRunStarted(input.ledgerRunId)
  }

  let result: SyncResult
  try {
    result = await runSync(syncPrisma, {
      scope: normalized.scope,
      incremental: normalized.incremental,
    })
  } catch (error) {
    if (input.ledgerRunId) {
      await markWorkflowRunFailed(input.ledgerRunId, error).catch(() => {})
    }
    throw error
  }

  if (input.ledgerRunId) {
    await recordCoreSyncRunResult(input.ledgerRunId, result)
  }

  return {
    ...result,
    scope: normalized.scope,
    trigger: normalized.trigger,
  }
}

export async function startCoreSyncJob(
  input: CoreSyncWorkflowInput = {},
): Promise<CoreSyncJobStart> {
  const normalized = normalizeCoreSyncInput(input)
  if (input.ledgerRunId) {
    await markWorkflowRunStarted(input.ledgerRunId)
  }

  const start = await startSyncRun(syncPrisma, {
    scope: normalized.scope,
    incremental: normalized.incremental,
  })

  if (start.skipped) {
    const result = {
      ...start.result,
      scope: normalized.scope,
      trigger: normalized.trigger,
    }

    if (input.ledgerRunId) {
      await recordCoreSyncRunResult(input.ledgerRunId, result)
    }

    return { skipped: true, result }
  }

  return {
    skipped: false,
    run: start.run,
    scope: normalized.scope,
    incremental: normalized.incremental,
    trigger: normalized.trigger,
    ledgerRunId: input.ledgerRunId,
  }
}

export async function runCoreSyncPhaseJob(
  start: Exclude<CoreSyncJobStart, { skipped: true }>,
  phase: SyncPhase,
): Promise<PhaseResult> {
  return runSyncPhase(syncPrisma, start.run, phase, {
    onProgress: start.ledgerRunId
      ? (progress) => {
          console.log(
            `[core-sync] event=core-sync.phase.progress phase=${progress.phase} completed=${progress.completed} total=${progress.total} elapsedMs=${progress.elapsedMs}`,
          )
          void recordCoreSyncPhaseProgress(start.ledgerRunId!, progress).catch(
            () => {},
          )
        }
      : undefined,
  })
}

export async function finishCoreSyncJob(
  start: Exclude<CoreSyncJobStart, { skipped: true }>,
  phases: PhaseResult[],
): Promise<CoreSyncJobResult> {
  const result = await finishSyncRun(syncPrisma, start.run, phases)
  const jobResult = {
    ...result,
    scope: start.scope,
    trigger: start.trigger,
  }

  if (start.ledgerRunId) {
    await recordCoreSyncRunResult(start.ledgerRunId, jobResult)
  }

  return jobResult
}

export async function failCoreSyncJob(
  start: Exclude<CoreSyncJobStart, { skipped: true }>,
  error: unknown,
): Promise<void> {
  await abortSyncRun(syncPrisma, start.run)

  if (start.ledgerRunId) {
    await markWorkflowRunFailed(start.ledgerRunId, error).catch(() => {})
  }
}

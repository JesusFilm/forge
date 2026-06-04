import { start } from "workflow/api"
import { syncPrisma } from "@/db/client"
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
import { runCoreSync } from "@/workflows/coreSync"

export type CoreSyncTrigger = "manual" | "scheduled" | "graphql"

export type CoreSyncWorkflowInput = {
  scope?: string | string[]
  incremental?: boolean
  trigger?: CoreSyncTrigger
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

import { start } from "workflow/api"
import { syncPrisma } from "@/db/client"
import {
  runSync,
  resolveScope,
  type SyncResult,
} from "@/services/core-sync/orchestrator"
import type { SyncPhase } from "@/services/core-sync/types"
import {
  attachWorkflowRuntimeRunId,
  createWorkflowRunLog,
  markWorkflowRunFailed,
  markWorkflowRunStarted,
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

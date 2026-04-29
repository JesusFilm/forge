import { syncPrisma } from "@/db/client"
import {
  runSync,
  resolveScope,
  type SyncResult,
} from "@/services/core-sync/orchestrator"
import type { SyncPhase } from "@/services/core-sync/types"

export type CoreSyncTrigger = "manual" | "scheduled" | "graphql"

export type CoreSyncWorkflowInput = {
  scope?: string | string[]
  incremental?: boolean
  trigger?: CoreSyncTrigger
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

export function normalizeCoreSyncInput(
  input: CoreSyncWorkflowInput = {},
): CoreSyncJobInput {
  return {
    scope: resolveScope(input.scope),
    incremental: input.incremental ?? true,
    trigger: input.trigger ?? "manual",
  }
}

export async function runCoreSyncJob(
  input: CoreSyncWorkflowInput = {},
): Promise<CoreSyncJobResult> {
  const normalized = normalizeCoreSyncInput(input)
  const result = await runSync(syncPrisma, {
    scope: normalized.scope,
    incremental: normalized.incremental,
  })

  return {
    ...result,
    scope: normalized.scope,
    trigger: normalized.trigger,
  }
}

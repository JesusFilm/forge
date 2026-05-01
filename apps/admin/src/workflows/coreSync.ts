import type {
  CoreSyncJobResult,
  CoreSyncWorkflowInput,
} from "@/services/core-sync/job"

export async function runCoreSync(
  input: CoreSyncWorkflowInput = {},
): Promise<CoreSyncJobResult> {
  "use workflow"

  return stepRunCoreSync(input)
}

async function stepRunCoreSync(
  input: CoreSyncWorkflowInput,
): Promise<CoreSyncJobResult> {
  "use step"

  const { runCoreSyncJob } = await import("@/services/core-sync/job")
  return runCoreSyncJob(input)
}

import { sleep } from "workflow"
import type {
  CoreSyncJobResult,
  CoreSyncJobStart,
  CoreSyncWorkflowInput,
} from "@/services/core-sync/job"
import type { PhaseResult } from "@/services/core-sync/orchestrator"
import type { SyncPhase } from "@/services/core-sync/types"

type StartedJob = Exclude<CoreSyncJobStart, { skipped: true }>

// Keep the original coreSync workflow for already-dispatched executions.
// New runs only perform bounded enqueue/observe steps over the native worker.
export async function runCoreSyncQueued(
  input: CoreSyncWorkflowInput = {},
): Promise<CoreSyncJobResult> {
  "use workflow"
  const started = await startJob(input)
  if (started.skipped) return started.result
  const phases: PhaseResult[] = []
  try {
    for (const phase of started.scope) {
      let result = await observePhase(started, phase)
      while (result === null) {
        await sleep("10s")
        result = await observePhase(started, phase)
      }
      phases.push(result)
    }
    return await finishJob(started, phases)
  } catch (error) {
    await failJob(
      started,
      error instanceof Error ? error.message : String(error),
    )
    throw error
  }
}

async function startJob(
  input: CoreSyncWorkflowInput,
): Promise<CoreSyncJobStart> {
  "use step"
  const { startCoreSyncJob } = await import("@/services/core-sync/job")
  return startCoreSyncJob(input)
}

async function observePhase(
  start: StartedJob,
  phase: SyncPhase,
): Promise<PhaseResult | null> {
  "use step"
  const { prisma } = await import("@/db/client")
  const { observeCoreSyncPhase } =
    await import("@/services/core-sync/phase-execution")
  return observeCoreSyncPhase(prisma, start, phase)
}

async function finishJob(
  start: StartedJob,
  phases: PhaseResult[],
): Promise<CoreSyncJobResult> {
  "use step"
  const { finishCoreSyncJob } = await import("@/services/core-sync/job")
  return finishCoreSyncJob(start, phases)
}

async function failJob(start: StartedJob, message: string): Promise<void> {
  "use step"
  const { failCoreSyncJob } = await import("@/services/core-sync/job")
  await failCoreSyncJob(start, message)
}

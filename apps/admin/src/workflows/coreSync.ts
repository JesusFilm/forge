import { sleep } from "workflow"
import type {
  CoreSyncJobResult,
  CoreSyncJobStart,
  CoreSyncSchedulerInput,
  CoreSyncWorkflowInput,
} from "@/services/core-sync/job"
import type { PhaseResult } from "@/services/core-sync/orchestrator"
import type { SyncPhase } from "@/services/core-sync/types"

type StartedCoreSyncJob = Exclude<CoreSyncJobStart, { skipped: true }>

export async function runCoreSync(
  input: CoreSyncWorkflowInput = {},
): Promise<CoreSyncJobResult> {
  "use workflow"

  const started = await stepStartCoreSync(input)
  if (started.skipped) {
    return started.result
  }

  const phases: PhaseResult[] = []

  try {
    if (shouldRunPhase(started, "languages")) {
      phases.push(await stepSyncLanguages(started))
    }
    if (shouldRunPhase(started, "countries")) {
      phases.push(await stepSyncCountries(started))
    }
    if (shouldRunPhase(started, "keywords")) {
      phases.push(await stepSyncKeywords(started))
    }
    if (shouldRunPhase(started, "video-origins")) {
      phases.push(await stepSyncVideoOrigins(started))
    }
    if (shouldRunPhase(started, "videos")) {
      phases.push(await stepSyncVideos(started))
    }
    if (shouldRunPhase(started, "video-images")) {
      phases.push(await stepSyncVideoImages(started))
    }
    if (shouldRunPhase(started, "video-editions")) {
      phases.push(await stepSyncVideoEditions(started))
    }
    if (shouldRunPhase(started, "video-subtitles")) {
      phases.push(await stepSyncVideoSubtitles(started))
    }
    if (shouldRunPhase(started, "video-dubs")) {
      phases.push(await stepSyncVideoDubs(started))
    }
    if (shouldRunPhase(started, "video-dub-downloads")) {
      phases.push(await stepSyncVideoDubDownloads(started))
    }

    return stepFinishCoreSync(started, phases)
  } catch (error) {
    await stepFailCoreSync(
      started,
      error instanceof Error ? error.message : String(error),
    )
    throw error
  }
}

export async function runCoreSyncScheduler(
  input: CoreSyncSchedulerInput = {},
): Promise<never> {
  "use workflow"

  await stepMarkSchedulerStarted(input)
  await stepRunScheduledCoreSync()

  while (true) {
    const nextRunAt = await stepNextRunAt(input)
    await sleep(nextRunAt)
    await stepRunScheduledCoreSync()
  }
}

async function stepMarkSchedulerStarted(
  input: CoreSyncSchedulerInput,
): Promise<void> {
  "use step"

  const { markCoreSyncSchedulerStarted } =
    await import("@/services/core-sync/job")
  await markCoreSyncSchedulerStarted(input)
}

async function stepNextRunAt(input: CoreSyncSchedulerInput): Promise<Date> {
  "use step"

  const { nextCoreSyncRunAt, recordCoreSyncSchedulerHeartbeat } =
    await import("@/services/core-sync/job")
  const nextRunAt = nextCoreSyncRunAt()
  await recordCoreSyncSchedulerHeartbeat(input, nextRunAt)
  return nextRunAt
}

async function stepRunScheduledCoreSync(): Promise<void> {
  "use step"

  const { runCoreSyncFromScheduler } = await import("@/services/core-sync/job")
  await runCoreSyncFromScheduler()
}

async function stepStartCoreSync(
  input: CoreSyncWorkflowInput,
): Promise<CoreSyncJobStart> {
  "use step"

  const { startCoreSyncJob } = await import("@/services/core-sync/job")
  return startCoreSyncJob(input)
}

async function stepSyncLanguages(
  start: StartedCoreSyncJob,
): Promise<PhaseResult> {
  "use step"

  return stepRunCoreSyncPhase(start, "languages")
}

async function stepSyncCountries(
  start: StartedCoreSyncJob,
): Promise<PhaseResult> {
  "use step"

  return stepRunCoreSyncPhase(start, "countries")
}

async function stepSyncKeywords(
  start: StartedCoreSyncJob,
): Promise<PhaseResult> {
  "use step"

  return stepRunCoreSyncPhase(start, "keywords")
}

async function stepSyncVideoOrigins(
  start: StartedCoreSyncJob,
): Promise<PhaseResult> {
  "use step"

  return stepRunCoreSyncPhase(start, "video-origins")
}

async function stepSyncVideos(start: StartedCoreSyncJob): Promise<PhaseResult> {
  "use step"

  return stepRunCoreSyncPhase(start, "videos")
}

async function stepSyncVideoImages(
  start: StartedCoreSyncJob,
): Promise<PhaseResult> {
  "use step"

  return stepRunCoreSyncPhase(start, "video-images")
}

async function stepSyncVideoEditions(
  start: StartedCoreSyncJob,
): Promise<PhaseResult> {
  "use step"

  return stepRunCoreSyncPhase(start, "video-editions")
}

async function stepSyncVideoSubtitles(
  start: StartedCoreSyncJob,
): Promise<PhaseResult> {
  "use step"

  return stepRunCoreSyncPhase(start, "video-subtitles")
}

async function stepSyncVideoDubs(
  start: StartedCoreSyncJob,
): Promise<PhaseResult> {
  "use step"

  return stepRunCoreSyncPhase(start, "video-dubs")
}

async function stepSyncVideoDubDownloads(
  start: StartedCoreSyncJob,
): Promise<PhaseResult> {
  "use step"

  return stepRunCoreSyncPhase(start, "video-dub-downloads")
}

async function stepRunCoreSyncPhase(
  start: StartedCoreSyncJob,
  phase: SyncPhase,
): Promise<PhaseResult> {
  const { runCoreSyncPhaseJob } = await import("@/services/core-sync/job")
  return runCoreSyncPhaseJob(start, phase)
}

async function stepFinishCoreSync(
  start: StartedCoreSyncJob,
  phases: PhaseResult[],
): Promise<CoreSyncJobResult> {
  "use step"

  const { finishCoreSyncJob } = await import("@/services/core-sync/job")
  return finishCoreSyncJob(start, phases)
}

async function stepFailCoreSync(
  start: StartedCoreSyncJob,
  errorMessage: string,
): Promise<void> {
  "use step"

  const { failCoreSyncJob } = await import("@/services/core-sync/job")
  await failCoreSyncJob(start, errorMessage)
}

function shouldRunPhase(start: StartedCoreSyncJob, phase: SyncPhase): boolean {
  return start.scope.includes(phase)
}

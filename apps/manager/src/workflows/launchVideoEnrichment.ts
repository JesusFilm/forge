import { start } from "workflow/api"
import { readEngineStamp } from "@/lib/engine-stamp"
import { getJob, markEnrichmentDispatched } from "@/lib/state"
import {
  dispatchMastraVideoEnrichment,
  startMastraVideoEnrichment,
} from "@/services/mastra-enrichment"
import {
  runVideoEnrichment,
  type VideoEnrichmentInput,
} from "@/workflows/videoEnrichment"
import { scheduleMastraFirstCallbackWatchdog } from "@/workflows/mastraEnrichmentWatchdog"

export class EnrichmentLaunchError extends Error {
  constructor(
    message: string,
    readonly jobId: string,
  ) {
    super(message)
    this.name = "EnrichmentLaunchError"
  }
}

export async function launchVideoEnrichment(input: VideoEnrichmentInput) {
  const job = await getJob(input.jobId)
  if (!job) {
    throw new EnrichmentLaunchError(
      `Cannot launch enrichment for missing job ${input.jobId}`,
      input.jobId,
    )
  }

  const engine = readEngineStamp(job.options)
  if (engine === "mastra") {
    const result = await dispatchMastraVideoEnrichment(input)
    if (!result.ok) {
      throw new EnrichmentLaunchError(
        `Mastra enrichment dispatch failed for job ${input.jobId}: ${result.reason}`,
        input.jobId,
      )
    }

    const dispatchedJob = await markEnrichmentDispatched(
      input.jobId,
      result.runId,
    )
    if (!dispatchedJob) {
      throw new EnrichmentLaunchError(
        `Mastra enrichment dispatch visibility failed for job ${input.jobId}`,
        input.jobId,
      )
    }

    const startResult = await startMastraVideoEnrichment(input, result.runId)
    if (!startResult.ok) {
      throw new EnrichmentLaunchError(
        `Mastra enrichment start failed for job ${input.jobId}: ${startResult.reason}`,
        input.jobId,
      )
    }

    scheduleMastraFirstCallbackWatchdog(input.jobId, startResult.runId)

    return startResult
  }

  return start(runVideoEnrichment, [input])
}

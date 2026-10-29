import { start } from "workflow/api"
import { prepareEnrichmentArtifactNamespace } from "@/lib/enrichment-artifact-namespace"
import { getJobArtifactStorageAssetId } from "@/lib/job-artifacts"
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
    const prepared = await prepareEnrichmentArtifactNamespace(input.jobId)
    const initialArtifacts = { ...prepared.artifacts }
    if (
      !prepared.options.enrichmentArtifacts?.sourceVerified ||
      input.requestedTranscriptionProvider === "mux" ||
      input.requestedTranscriptionProvider === "elevenlabs"
    ) {
      delete initialArtifacts.transcript
      delete initialArtifacts.subtitles
      delete initialArtifacts.subtitlesVtt
    }
    const dispatchInput = {
      ...input,
      assetId: getJobArtifactStorageAssetId(prepared),
      muxAssetId: prepared.muxAssetId,
      initialArtifacts,
    }
    const result = await dispatchMastraVideoEnrichment(dispatchInput)
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

    const startResult = await startMastraVideoEnrichment(
      dispatchInput,
      result.runId,
    )
    if (!startResult.ok) {
      throw new EnrichmentLaunchError(
        `Mastra enrichment start failed for job ${input.jobId}: ${startResult.reason}`,
        input.jobId,
      )
    }

    scheduleMastraFirstCallbackWatchdog(input.jobId, startResult.runId)

    return startResult
  }

  // An engine rollback must keep the prepared namespace and must not bypass
  // an incomplete preparation by writing back into the old shared prefix.
  const storageJob =
    job.options.enrichmentArtifacts === undefined
      ? job
      : await prepareEnrichmentArtifactNamespace(input.jobId)
  return start(runVideoEnrichment, [
    { ...input, assetId: getJobArtifactStorageAssetId(storageJob) },
  ])
}

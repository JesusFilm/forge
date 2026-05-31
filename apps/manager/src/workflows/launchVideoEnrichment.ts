import { start } from "workflow/api"
import { readEngineStamp } from "@/lib/engine-stamp"
import { getJob, markEnrichmentDispatched } from "@/lib/state"
import { dispatchMastraVideoEnrichment } from "@/services/mastra-enrichment"
import {
  runVideoEnrichment,
  type VideoEnrichmentInput,
} from "@/workflows/videoEnrichment"

export async function launchVideoEnrichment(input: VideoEnrichmentInput) {
  const job = await getJob(input.jobId)
  const engine = readEngineStamp(job?.options)
  if (engine === "mastra") {
    const result = await dispatchMastraVideoEnrichment(input)
    if (!result.ok) {
      throw new Error(
        `Mastra enrichment dispatch failed for job ${input.jobId}: ${result.reason}`,
      )
    }

    await markEnrichmentDispatched(input.jobId, result.runId)
    return result
  }

  return start(runVideoEnrichment, [input])
}

// NOTE: The "use workflow" and "use step" directives require the workflow SDK's
// build plugin to be active for durable execution. Without the plugin configured
// in next.config.ts, these directives are inert and the workflow runs as a plain
// async function (no durability, no step-level retries, no checkpointing).
// To enable: configure the workflow plugin and set WORKFLOW_API_KEY in env.
// See: https://useworkflow.dev/
//
// Video enrichment workflow — orchestrates the full pipeline for a single video asset.
// Steps: transcribe -> translate -> chapters -> metadata -> embeddings
//
// Uses the `workflow` package ("use workflow" / "use step" directives)
// for durable execution. Each step is idempotent.

import { updateJob } from "@/lib/state"
import type { JobStep } from "@/lib/state"

export type VideoEnrichmentInput = {
  jobId: string
  assetId: string
  muxAssetId: string
  language?: string
  translateTo?: string[]
}

export type VideoEnrichmentOutput = {
  assetId: string
  transcript: string
  language: string
  chapters: { title: string; startSeconds: number }[]
  tags: string[]
}

async function markStep(
  jobId: string,
  step: JobStep,
  completedSteps: JobStep[],
) {
  await updateJob(jobId, {
    status: "processing",
    currentStep: step,
    completedSteps,
  })
}

export async function runVideoEnrichment(
  input: VideoEnrichmentInput,
): Promise<VideoEnrichmentOutput> {
  "use workflow"

  const completedSteps: JobStep[] = []
  const language = input.language ?? "en"

  console.log(
    JSON.stringify({
      event: "workflow_start",
      jobId: input.jobId,
      assetId: input.assetId,
    }),
  )

  try {
    // Step 1: Transcription
    console.log(
      JSON.stringify({
        event: "step_start",
        jobId: input.jobId,
        step: "transcription",
      }),
    )
    await markStep(input.jobId, "transcription", completedSteps)
    const transcription = await stepTranscribe(
      input.assetId,
      input.muxAssetId,
      language,
    )
    completedSteps.push("transcription")
    console.log(
      JSON.stringify({
        event: "step_complete",
        jobId: input.jobId,
        step: "transcription",
      }),
    )

    // Steps 2-5: Translation, chapters, metadata, embeddings
    // These all depend only on transcription.text, so run them in parallel.
    // NOTE: If the workflow SDK ("use step") does not support concurrent step
    // invocations, revert this to the original sequential execution.
    const targets = input.translateTo ?? []
    const parallelSteps: JobStep[] = [
      "translation",
      "chapters",
      "metadata",
      "embeddings",
    ]
    for (const step of parallelSteps) {
      console.log(
        JSON.stringify({ event: "step_start", jobId: input.jobId, step }),
      )
      await markStep(input.jobId, step, completedSteps)
    }

    const [, chaptersResult, metadataResult] = await Promise.all([
      // Translation: fan out one step per target language
      Promise.all(
        targets.map((targetLang) =>
          stepTranslate(
            input.assetId,
            transcription.text,
            language,
            targetLang,
          ),
        ),
      ),
      // Chapters
      stepChapters(input.assetId, transcription.text),
      // Metadata
      stepMetadata(input.assetId, transcription.text, language),
      // Embeddings
      stepEmbeddings(input.assetId, transcription.text),
    ])

    completedSteps.push(...parallelSteps)
    for (const step of parallelSteps) {
      console.log(
        JSON.stringify({ event: "step_complete", jobId: input.jobId, step }),
      )
    }

    // Mark complete
    await updateJob(input.jobId, {
      status: "completed",
      currentStep: null,
      completedSteps,
    })

    console.log(
      JSON.stringify({
        event: "workflow_complete",
        jobId: input.jobId,
        assetId: input.assetId,
      }),
    )

    return {
      assetId: input.assetId,
      transcript: transcription.text,
      language: transcription.language,
      chapters: chaptersResult.chapters.map((c) => ({
        title: c.title,
        startSeconds: c.startSeconds,
      })),
      tags: metadataResult.tags,
    }
  } catch (error: unknown) {
    console.log(
      JSON.stringify({
        event: "workflow_error",
        jobId: input.jobId,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    )
    await updateJob(input.jobId, {
      status: "failed",
      currentStep: null,
      error: error instanceof Error ? error.message : "Unknown error",
    })
    throw error
  }
}

async function stepTranscribe(
  assetId: string,
  muxAssetId: string,
  language: string,
) {
  "use step"
  const { transcribe } = await import("@/services/transcription")
  return transcribe(assetId, muxAssetId, language)
}

async function stepTranslate(
  assetId: string,
  sourceText: string,
  sourceLanguage: string,
  targetLanguage: string,
) {
  "use step"
  const { translate } = await import("@/services/translation")
  return translate(assetId, sourceText, sourceLanguage, targetLanguage)
}

async function stepChapters(assetId: string, transcript: string) {
  "use step"
  const { generateChapters } = await import("@/services/chapters")
  return generateChapters(assetId, transcript)
}

async function stepMetadata(
  assetId: string,
  transcript: string,
  language: string,
) {
  "use step"
  const { extractMetadata } = await import("@/services/metadata")
  return extractMetadata(assetId, transcript, language)
}

async function stepEmbeddings(assetId: string, transcript: string) {
  "use step"
  const { generateEmbeddings } = await import("@/services/embeddings")
  return generateEmbeddings(assetId, transcript)
}

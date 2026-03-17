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

  // Step 1: Transcription
  await markStep(input.jobId, "transcription", completedSteps)
  const transcription = await stepTranscribe(
    input.assetId,
    input.muxAssetId,
    language,
  )
  completedSteps.push("transcription")

  // Step 2: Translation (if target languages specified)
  await markStep(input.jobId, "translation", completedSteps)
  const targets = input.translateTo ?? []
  for (const targetLang of targets) {
    await stepTranslate(input.assetId, transcription.text, language, targetLang)
  }
  completedSteps.push("translation")

  // Step 3: Chapters
  await markStep(input.jobId, "chapters", completedSteps)
  const chaptersResult = await stepChapters(input.assetId, transcription.text)
  completedSteps.push("chapters")

  // Step 4: Metadata
  await markStep(input.jobId, "metadata", completedSteps)
  const metadataResult = await stepMetadata(
    input.assetId,
    transcription.text,
    language,
  )
  completedSteps.push("metadata")

  // Step 5: Embeddings
  await markStep(input.jobId, "embeddings", completedSteps)
  await stepEmbeddings(input.assetId, transcription.text)
  completedSteps.push("embeddings")

  // Mark complete
  await updateJob(input.jobId, {
    status: "completed",
    currentStep: null,
    completedSteps,
  })

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

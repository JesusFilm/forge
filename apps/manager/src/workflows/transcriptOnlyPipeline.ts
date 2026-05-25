// Transcript-only pipeline (feat-119 PR2).
//
// Composition of transcription with the Mastra-owned transcript embedding
// workflow. Manager produces transcript source data only:
//
//   1. `transcribe(assetId, muxAssetId, languageCode)` — uses Mux's
//      auto-generated subtitles (or ElevenLabs when configured) to
//      produce a `TranscriptionResult` and writes
//      `{assetId}/transcript.json` + `{assetId}/subtitles.vtt`.
//   2. `launchMastraTranscriptEmbeddings(...)`
//      — sends transcript text + timed segments to Mastra. Mastra plans
//      chunks, embeds, and writes vectors through Admin ingest.
//
// Deliberately NOT a "use workflow" boundary — same shape as the
// existing `runSceneAnalysisPipeline` (called as a regular async
// function from a route's `after()` background dispatch). Keeps the
// trigger surface symmetric with scene-analysis.
//
// Plan §Unit 7 left "extract from videoEnrichment.ts vs new parallel
// file" as deferred-to-implementation. This file now preserves that trigger
// boundary while moving transcript embedding ownership out of Manager.

import { launchMastraTranscriptEmbeddings } from "@/services/mastra-transcript-embeddings"
import {
  transcribe,
  transcribeSubtitleUrl,
  type TranscriptionResult,
} from "@/services/transcription"

export type TranscriptOnlyPipelineInput = {
  /** Operator-facing source identifier. Used as the storage-key prefix
   *  for the produced transcript artifacts. */
  assetId: string
  /** Mux asset id for subtitle/transcript retrieval. */
  muxAssetId: string
  /** Admin video id when Admin originated the run and can provide it. */
  adminVideoId?: string
  /** Optional already-selected subtitle URL from admin's dispatch-field lookup. */
  subtitleUrl?: string
  /** Optional BCP-47 source language. When omitted manager falls
   *  back to "auto" which lets Mux pick. */
  languageCode?: string
}

export type TranscriptOnlyPipelineOutput = {
  assetId: string
  language: string
  totalChunks: number
  totalTokens: number
  embeddingDimensions: number
  embeddingStatus: string
  mastraRunId: string
  sourceContentHash: string
}

export async function runTranscriptOnlyPipeline(
  input: TranscriptOnlyPipelineInput,
): Promise<TranscriptOnlyPipelineOutput> {
  const startedAt = Date.now()
  const language = input.languageCode ?? "auto"

  console.log(
    JSON.stringify({
      event: "transcript_only_pipeline_start",
      assetId: input.assetId,
      muxAssetId: input.muxAssetId,
      language,
    }),
  )

  const transcription: TranscriptionResult = input.subtitleUrl
    ? await transcribeSubtitleUrl(input.assetId, input.subtitleUrl, language)
    : await transcribe(input.assetId, input.muxAssetId, language)

  if (!transcription.text || transcription.text.length < 10) {
    throw new Error(
      `transcript too short or empty for assetId=${input.assetId} (got ${transcription.text?.length ?? 0} chars)`,
    )
  }

  const embeddingResult = await launchMastraTranscriptEmbeddings({
    assetId: input.assetId,
    muxAssetId: input.muxAssetId,
    ...(input.adminVideoId ? { adminVideoId: input.adminVideoId } : {}),
    language: transcription.language,
    transcript: {
      text: transcription.text,
      segments: transcription.segments,
      artifactKey: `${input.assetId}/transcript.json`,
      provider: transcription.resolvedProvider,
    },
  })

  if (!embeddingResult.ok) {
    throw new Error(
      `Mastra transcript embedding failed for assetId=${input.assetId}: ${embeddingResult.reason}`,
    )
  }

  console.log(
    JSON.stringify({
      event: "transcript_only_pipeline_complete",
      assetId: input.assetId,
      durationMs: Date.now() - startedAt,
      language: transcription.language,
      embeddingStatus: embeddingResult.status,
      totalChunks: embeddingResult.chunks,
      totalTokens: embeddingResult.totalTokens,
      embeddingDimensions: embeddingResult.dimensions,
      mastraRunId: embeddingResult.mastraRunId,
    }),
  )

  return {
    assetId: input.assetId,
    language: transcription.language,
    totalChunks: embeddingResult.chunks,
    totalTokens: embeddingResult.totalTokens,
    embeddingDimensions: embeddingResult.dimensions,
    embeddingStatus: embeddingResult.status,
    mastraRunId: embeddingResult.mastraRunId,
    sourceContentHash: embeddingResult.sourceContentHash,
  }
}

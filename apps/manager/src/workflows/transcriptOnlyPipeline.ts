// Transcript-only pipeline (feat-119 PR2).
//
// Composition of two existing services to produce the
// `{assetId}/embeddings.json` artifact admin's R2 backfill consumes:
//
//   1. `transcribe(assetId, muxAssetId, languageCode)` — uses Mux's
//      auto-generated subtitles (or ElevenLabs when configured) to
//      produce a `TranscriptionResult` and writes
//      `{assetId}/transcript.json` + `{assetId}/subtitles.vtt`.
//   2. `generateEmbeddings(assetId, { text, segments, language })`
//      — chunks + embeds via OpenRouter and writes
//      `{assetId}/embeddings.json` (including per-chunk vectors,
//      which is the contract R2 reads back via
//      `readEmbeddingsArtifact`).
//
// Deliberately NOT a "use workflow" boundary — same shape as the
// existing `runSceneAnalysisPipeline` (called as a regular async
// function from a route's `after()` background dispatch). Keeps the
// trigger surface symmetric with scene-analysis.
//
// Plan §Unit 7 left "extract from videoEnrichment.ts vs new parallel
// file" as deferred-to-implementation. This is the new parallel file:
// it composes the two services without modifying `videoEnrichment.ts`,
// preserving PR2's hard decoupling constraint (no edits to existing
// pipelines or workflows). The contract is "produce the right
// embeddings.json artifact at {assetId}/embeddings.json"; everything
// else (the EnrichmentJob lifecycle, retry context, auth headers
// passed through enrich workflows) belongs to the enrich path and is
// out of scope here.

import {
  generateEmbeddings,
  type EmbeddingsResult,
} from "@/services/embeddings"
import {
  transcribe,
  transcribeSubtitleUrl,
  type TranscriptionResult,
} from "@/services/transcription"

export type TranscriptOnlyPipelineInput = {
  /** Operator-facing identifier (cms videos.id stringified). Used
   *  as the storage-key prefix for the produced artifacts. */
  assetId: string
  /** Mux asset id (from the cms video's primary-language variant). */
  muxAssetId: string
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

  const embeddings: EmbeddingsResult = await generateEmbeddings(input.assetId, {
    text: transcription.text,
    segments: transcription.segments,
    language: transcription.language,
  })

  console.log(
    JSON.stringify({
      event: "transcript_only_pipeline_complete",
      assetId: input.assetId,
      durationMs: Date.now() - startedAt,
      language: transcription.language,
      totalChunks: embeddings.metadata.totalChunks,
      totalTokens: embeddings.metadata.totalTokens,
      embeddingDimensions: embeddings.dimensions,
    }),
  )

  return {
    assetId: input.assetId,
    language: transcription.language,
    totalChunks: embeddings.metadata.totalChunks,
    totalTokens: embeddings.metadata.totalTokens,
    embeddingDimensions: embeddings.dimensions,
  }
}

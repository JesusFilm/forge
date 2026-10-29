import { runSubtitleSource } from "../subtitle-enrichment/source"
import { readSubtitleArtifact } from "../subtitle-enrichment/storage"
import { parseTranscriptArtifact } from "../subtitle-enrichment/transcript"
import { runSubtitleEnrichmentWorkflow } from "../../mastra/workflows/subtitle-enrichment"
import { runTranscriptScriptureCorrectionWorkflow } from "../../mastra/workflows/transcript-scripture-correction"
import { runTranscriptEmbeddingWorkflow } from "../../mastra/workflows/transcript-embedding"
import { generateChapters } from "./chapters"
import { extractMetadata } from "./metadata"
import { extractAndStoreSceneBoundaries } from "./scene-boundaries"
import { analyzeAllScenes } from "./scene-analysis"
import { resolveScenePlaybackId } from "./scene-thumbnails"
import { enrichmentProviderFetch } from "./provider-spend"
import type { ForgeVideoEnrichmentInput } from "../../server/forge-video-enrichment-contract"
import type { SubtitleSourceResult } from "../subtitle-enrichment/source"

export type EnrichmentTranscript = Pick<
  SubtitleSourceResult,
  "text" | "segments" | "language"
>
export const videoEnrichmentRuntime = {
  source: runSubtitleSource,
  correction: runTranscriptScriptureCorrectionWorkflow,
  translation: runSubtitleEnrichmentWorkflow,
  chapters: generateChapters,
  metadata: extractMetadata,
  embeddings: (
    input: Parameters<typeof runTranscriptEmbeddingWorkflow>[0],
    options: { runId: string },
  ) =>
    runTranscriptEmbeddingWorkflow(input, {
      ...options,
      fetchImpl: (...args) => enrichmentProviderFetch(fetch, ...args),
    }),
  readCorrected: async (assetId: string): Promise<EnrichmentTranscript> => {
    const transcript = parseTranscriptArtifact(
      await readSubtitleArtifact(assetId, "transcript", "json"),
    )
    if (!transcript.language)
      throw new Error("Corrected transcript language is missing")
    return {
      text: transcript.segments.map((segment) => segment.text).join(" "),
      segments: transcript.segments,
      language: transcript.language,
    }
  },
  scene: async (
    input: ForgeVideoEnrichmentInput,
    transcript: EnrichmentTranscript,
    chapters: Awaited<ReturnType<typeof generateChapters>>["chapters"],
  ) => {
    const playbackId = await resolveScenePlaybackId(input)
    const boundaries = await extractAndStoreSceneBoundaries(
      input.assetId,
      chapters,
      transcript.text,
    )
    await analyzeAllScenes(input.assetId, playbackId, boundaries.scenes, {
      videoLabel: input.videoLabel ?? "unknown",
      bibleVerses: input.bibleVerses,
      inputLanguageBcp47: transcript.language,
      muxAssetId: input.muxAssetId,
      transcriptSource: {
        kind: "mux-transcription",
        languageBcp47: transcript.language,
        muxAssetId: input.muxAssetId,
      },
    })
    return { artifactKeys: ["scene-boundaries", "scene-analysis"] }
  },
}
export type VideoEnrichmentRuntime = typeof videoEnrichmentRuntime

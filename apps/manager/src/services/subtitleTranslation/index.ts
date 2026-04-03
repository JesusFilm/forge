// Subtitle Translation Pipeline — orchestrates the 3-phase split-brain architecture.
// Phase 1: Smart Chunking (algorithmic) → shared across all languages
// Phase 2: Creative Translation (LLM per language) → meaning only, no constraints
// Phase 3: LLM Re-timing (LLM per language) → redistribute text across time slots
//
// Replaces the old full-text translation service.

import pLimit from "p-limit"
import { readArtifact, writeArtifact } from "@/services/storage"
import { segmentsToVTT } from "@/lib/vtt"
import { chunkSegments } from "./chunker"
import { translateChunk } from "./translator"
import { retimeChunk } from "./retimer"
import { loadLanguageConfig } from "./languageConfig"
import type { TranscriptSegment, LanguageResult } from "./types"

const CONCURRENCY_LIMIT = 10

export type TranslateSubtitlesOptions = {
  assetId: string
  sourceLanguage: string
  targetLanguages: string[]
}

/**
 * Translate subtitles for all target languages.
 * Reads the transcript artifact, chunks it once, then fans out
 * parallel translation pipelines per language.
 */
export async function translateSubtitles(
  options: TranslateSubtitlesOptions,
): Promise<LanguageResult[]> {
  const { assetId, sourceLanguage, targetLanguages } = options

  console.log(
    JSON.stringify({
      event: "subtitle_translation_start",
      assetId,
      sourceLanguage,
      languageCount: targetLanguages.length,
    }),
  )

  // 1. Read transcript artifact (contains segments with timing)
  const transcriptBytes = await readArtifact(assetId, "transcript", "json")
  const transcript = JSON.parse(new TextDecoder().decode(transcriptBytes)) as {
    segments: TranscriptSegment[]
  }

  // 2. Smart chunk the segments (once, shared across all languages)
  const chunks = chunkSegments(transcript.segments)

  console.log(
    JSON.stringify({
      event: "chunking_complete",
      assetId,
      segmentCount: transcript.segments.length,
      chunkCount: chunks.length,
    }),
  )

  // 3. Fan out: p-limit(10) across target languages
  const limit = pLimit(CONCURRENCY_LIMIT)

  const results = await Promise.all(
    targetLanguages.map((lang) =>
      limit(() => translateLanguage(assetId, sourceLanguage, lang, chunks)),
    ),
  )

  const succeeded = results.filter((r) => r.status === "completed").length
  const failed = results.filter((r) => r.status === "failed").length

  console.log(
    JSON.stringify({
      event: "subtitle_translation_complete",
      assetId,
      succeeded,
      failed,
      total: targetLanguages.length,
    }),
  )

  if (targetLanguages.length > 0 && succeeded === 0) {
    const failedLanguages = results
      .filter((result) => result.status === "failed")
      .map((result) =>
        result.error ? `${result.lang}: ${result.error}` : result.lang,
      )

    throw new Error(
      `Subtitle translation failed for all target languages (${failedLanguages.join(", ")})`,
    )
  }

  return results
}

/**
 * Translate all chunks for a single target language.
 * Runs the 3-phase pipeline per chunk, then assembles the final VTT.
 */
async function translateLanguage(
  assetId: string,
  sourceLanguage: string,
  targetLanguage: string,
  chunks: ReturnType<typeof chunkSegments>,
): Promise<LanguageResult> {
  try {
    console.log(
      JSON.stringify({
        event: "language_start",
        assetId,
        language: targetLanguage,
        chunkCount: chunks.length,
      }),
    )

    // Load optional per-language config
    const config = await loadLanguageConfig(targetLanguage)

    // Process each chunk through translate → retime
    const allSegments: TranscriptSegment[] = []

    for (const chunk of chunks) {
      // Phase 2: Creative translation
      const translatedText = await translateChunk(chunk, targetLanguage, config)

      // Phase 3: LLM re-timing (includes correction loop + fallback)
      const retimed = await retimeChunk(
        chunk,
        translatedText,
        targetLanguage,
        config,
      )

      allSegments.push(...retimed)
    }

    // Assemble and write VTT artifact
    const vttContent = segmentsToVTT(allSegments, {
      language: targetLanguage,
      assetId,
    })
    const vttKey = await writeArtifact({
      assetId,
      artifactType: `subtitles-${targetLanguage}`,
      ext: "vtt",
      body: vttContent,
      contentType: "text/vtt",
    })

    // Derive and write full translated text JSON
    const fullText = allSegments.map((s) => s.text).join(" ")
    const translationResult = {
      sourceLanguage,
      targetLanguage,
      text: fullText,
    }
    const jsonKey = await writeArtifact({
      assetId,
      artifactType: `translation-${targetLanguage}`,
      ext: "json",
      body: JSON.stringify(translationResult, null, 2),
      contentType: "application/json",
    })

    console.log(
      JSON.stringify({
        event: "language_complete",
        assetId,
        language: targetLanguage,
        segmentCount: allSegments.length,
      }),
    )

    return {
      lang: targetLanguage,
      status: "completed",
      artifactKeys: { vtt: vttKey, json: jsonKey },
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error"

    console.log(
      JSON.stringify({
        event: "language_failed",
        assetId,
        language: targetLanguage,
        error,
      }),
    )

    return {
      lang: targetLanguage,
      status: "failed",
      error,
    }
  }
}

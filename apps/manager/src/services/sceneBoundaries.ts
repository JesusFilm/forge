// Scene boundaries service — maps chapter segmentation to scene boundaries
// for downstream scene analysis and embedding (feat-039).
//
// Consumes Chapter[] output from chapters.ts without modifying it.
// For short clips (single chapter), the chapter IS the scene.

import type { Chapter } from "@/services/chapters"
import { writeArtifact, readArtifact, artifactExists } from "@/services/storage"

export type SceneBoundary = {
  sceneIndex: number
  startSeconds: number
  endSeconds: number | null
  chapterTitle: string | null
  transcriptChunk: string
}

export type SceneBoundariesResult = {
  scenes: SceneBoundary[]
}

/**
 * Splits transcript text into chunks aligned to chapter boundaries.
 *
 * Chapters have startSeconds/endSeconds but no direct transcript offsets.
 * Since we don't have word-level timestamps, we split the transcript
 * proportionally by chapter duration. This is an approximation — downstream
 * multimodal analysis (feat-040) will use the actual video segment + transcript
 * chunk together, so rough alignment is acceptable.
 */
function splitTranscriptByChapters(
  transcript: string,
  chapters: Chapter[],
): string[] {
  if (chapters.length === 0) return [transcript]
  if (chapters.length === 1) return [transcript]

  // Compute each chapter's duration. For the last chapter (endSeconds = null),
  // use the remaining proportion.
  const totalDuration = chapters.reduce(
    (max, ch) => {
      if (ch.endSeconds != null && ch.endSeconds > max) return ch.endSeconds
      return max
    },
    chapters[chapters.length - 1]?.startSeconds ?? 0,
  )

  if (totalDuration <= 0) return [transcript]

  const words = transcript.split(/\s+/)
  const totalWords = words.length

  const chunks: string[] = []
  let wordOffset = 0

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i]!
    const start = ch.startSeconds
    const end = ch.endSeconds ?? chapters[i + 1]?.startSeconds ?? totalDuration

    const duration = end - start
    const proportion = duration / totalDuration
    const wordCount =
      i === chapters.length - 1
        ? totalWords - wordOffset
        : Math.round(proportion * totalWords)

    const chunk = words.slice(wordOffset, wordOffset + wordCount).join(" ")
    chunks.push(chunk)
    wordOffset += wordCount
  }

  return chunks
}

export function extractSceneBoundaries(
  chapters: Chapter[],
  transcript: string,
): SceneBoundariesResult {
  if (chapters.length === 0) {
    return {
      scenes: [
        {
          sceneIndex: 0,
          startSeconds: 0,
          endSeconds: null,
          chapterTitle: null,
          transcriptChunk: transcript,
        },
      ],
    }
  }

  const transcriptChunks = splitTranscriptByChapters(transcript, chapters)

  const scenes: SceneBoundary[] = chapters.map((chapter, i) => ({
    sceneIndex: i,
    startSeconds: chapter.startSeconds,
    endSeconds: chapter.endSeconds,
    chapterTitle: chapter.title,
    transcriptChunk: transcriptChunks[i] ?? "",
  }))

  return { scenes }
}

export async function extractAndStoreSceneBoundaries(
  assetId: string,
  chapters: Chapter[],
  transcript: string,
): Promise<SceneBoundariesResult> {
  const result = extractSceneBoundaries(chapters, transcript)

  await writeArtifact({
    assetId,
    artifactType: "scene-boundaries",
    ext: "json",
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  })

  return result
}

export async function loadSceneBoundaries(
  assetId: string,
): Promise<SceneBoundariesResult | null> {
  const exists = await artifactExists(assetId, "scene-boundaries", "json")
  if (!exists) return null

  const data = await readArtifact(assetId, "scene-boundaries", "json")
  return JSON.parse(new TextDecoder().decode(data)) as SceneBoundariesResult
}

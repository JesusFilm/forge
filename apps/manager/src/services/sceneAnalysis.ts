// Scene analysis service — multimodal video + transcript analysis via Gemini.
// Extracts structured signals (themes, bible verses, demographics, tone, content)
// for each scene in a video. Feat-040.

import { z } from "zod"
import { analyzeVideoScene } from "@/services/gemini"
import { getSignedMp4Url } from "@/services/mux"
import { writeArtifact } from "@/services/storage"
import { parseLLMJson } from "@/lib/parseLLMJson"
import type { SceneBoundary } from "@/services/sceneBoundaries"

export type SceneAnalysis = {
  sceneIndex: number
  startSeconds: number
  endSeconds: number | null
  chapterTitle: string | null
  description: string
  themes: string[]
  bibleVerses: string[]
  demographics: string[]
}

export type SceneAnalysisResult = {
  scenes: SceneAnalysis[]
  totalInputTokens: number
  totalOutputTokens: number
}

const geminiOutputSchema = z.object({
  themes: z.array(z.string()).default([]),
  bibleVerses: z.array(z.string()).default([]),
  content: z.string().default(""),
  tone: z.string().default(""),
  demographics: z.array(z.string()).default([]),
})

type GeminiOutput = z.infer<typeof geminiOutputSchema>

const GEMINI_OUTPUT_FALLBACK: GeminiOutput = {
  themes: [],
  bibleVerses: [],
  content: "",
  tone: "",
  demographics: [],
}

/**
 * Construct the description field by concatenating signals in priority order.
 * Themes appear first to weight them higher in the downstream embedding.
 */
export function buildDescription(output: GeminiOutput): string {
  const parts: string[] = []

  if (output.themes.length > 0) {
    parts.push(`Themes: ${output.themes.join(", ")}.`)
  }
  if (output.bibleVerses.length > 0) {
    parts.push(`Bible verses: ${output.bibleVerses.join(", ")}.`)
  }
  if (output.content) {
    parts.push(`Content: ${output.content}`)
  }
  if (output.tone) {
    parts.push(`Tone: ${output.tone}.`)
  }
  if (output.demographics.length > 0) {
    parts.push(`Demographics: ${output.demographics.join(", ")}.`)
  }

  return parts.join("\n")
}

export async function analyzeScene(
  playbackId: string,
  boundary: SceneBoundary,
  metadata: { videoLabel: string; bibleVerses?: string[] },
): Promise<{
  analysis: SceneAnalysis
  inputTokens: number
  outputTokens: number
}> {
  const videoUrl = await getSignedMp4Url(playbackId)

  const { text, inputTokens, outputTokens } = await analyzeVideoScene({
    videoUrl,
    transcriptChunk: boundary.transcriptChunk,
    startSeconds: boundary.startSeconds,
    endSeconds: boundary.endSeconds,
    chapterTitle: boundary.chapterTitle,
    metadata,
  })

  const output = parseLLMJson(
    text,
    geminiOutputSchema,
    GEMINI_OUTPUT_FALLBACK,
    "scene_analysis",
  )

  const analysis: SceneAnalysis = {
    sceneIndex: boundary.sceneIndex,
    startSeconds: boundary.startSeconds,
    endSeconds: boundary.endSeconds,
    chapterTitle: boundary.chapterTitle,
    description: buildDescription(output),
    themes: output.themes,
    bibleVerses: output.bibleVerses,
    demographics: output.demographics,
  }

  return { analysis, inputTokens, outputTokens }
}

export async function analyzeAllScenes(
  assetId: string,
  playbackId: string,
  boundaries: SceneBoundary[],
  metadata: { videoLabel: string; bibleVerses?: string[] },
): Promise<SceneAnalysisResult> {
  const scenes: SceneAnalysis[] = []
  let totalInputTokens = 0
  let totalOutputTokens = 0

  console.log(
    JSON.stringify({
      event: "scene_analysis_batch_start",
      assetId,
      sceneCount: boundaries.length,
    }),
  )

  for (const boundary of boundaries) {
    const { analysis, inputTokens, outputTokens } = await analyzeScene(
      playbackId,
      boundary,
      metadata,
    )
    scenes.push(analysis)
    totalInputTokens += inputTokens
    totalOutputTokens += outputTokens
  }

  const result: SceneAnalysisResult = {
    scenes,
    totalInputTokens,
    totalOutputTokens,
  }

  await writeArtifact({
    assetId,
    artifactType: "scene-analysis",
    ext: "json",
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  })

  console.log(
    JSON.stringify({
      event: "scene_analysis_batch_complete",
      assetId,
      sceneCount: scenes.length,
      totalInputTokens,
      totalOutputTokens,
    }),
  )

  return result
}

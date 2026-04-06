// Scene analysis service — multimodal still-frame + transcript analysis via OpenRouter.
// Extracts structured signals (themes, bible verses, demographics, tone, content)
// for each scene in a video using the existing OpenRouter client with Gemini 2.5 Flash.
// Sends 3 representative thumbnail frames per scene alongside the transcript chunk.
// Feat-040.

import { z } from "zod"
import { getOpenrouter, DEFAULT_MODEL } from "@/services/openrouter"
import { getSceneThumbnailUrls } from "@/services/mux"
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

type RawSceneSignals = z.infer<typeof geminiOutputSchema>

const EMPTY_SCENE_SIGNALS: RawSceneSignals = {
  themes: [],
  bibleVerses: [],
  content: "",
  tone: "",
  demographics: [],
}

const SCENE_ANALYSIS_SYSTEM_PROMPT = `You are a ministry content analyst for JesusFilm. You will receive representative still frames from a video scene along with the transcript text for that scene.

Extract the following signals, ordered by importance:

1. **Felt needs / themes** (MOST IMPORTANT): What human need does this scene address? Examples: forgiveness, hope, grief, loneliness, identity, redemption, belonging, purpose, healing, doubt, courage, fear, reconciliation, guilt, mercy, faith, love, justice, peace, joy, patience, kindness. Return 2-5 themes.

2. **Bible verses**: Scripture references relevant to this scene's themes. Include any provided CMS references if they match, plus additional verses you identify. Use standard format like "Matthew 6:14-15". Return 1-5 verses.

3. **Content**: A 1-3 sentence narrative summary of what happens in the scene — the dialogue, actions, and message being communicated.

4. **Emotional tone**: One or two words describing the tone. Examples: contemplative, joyful, grieving, urgent, peaceful, hopeful, sorrowful, reverent, celebratory.

5. **Demographics** (ONLY if clearly evident): Target audience signals like age group (children, youth, young adult, adult, elderly) or life stage (student, parent, married, widowed). Leave empty if not clearly applicable.

Return valid JSON only:
{
  "themes": ["theme1", "theme2"],
  "bibleVerses": ["Book Chapter:Verse"],
  "content": "Summary of what happens...",
  "tone": "emotional tone",
  "demographics": ["demographic1"]
}`

/**
 * Construct the description field by concatenating signals in priority order.
 * Themes appear first to weight them higher in the downstream embedding.
 */
export function buildDescription(output: RawSceneSignals): string {
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
  // Get 3 representative frames from the scene
  const thumbnailUrls = getSceneThumbnailUrls(
    playbackId,
    boundary.startSeconds,
    boundary.endSeconds,
  )

  const timeRange =
    boundary.endSeconds != null
      ? `from ${boundary.startSeconds}s to ${boundary.endSeconds}s`
      : `starting at ${boundary.startSeconds}s to the end`

  const userText = [
    `Scene time range: ${timeRange}`,
    boundary.chapterTitle ? `Chapter: ${boundary.chapterTitle}` : null,
    `Video type: ${metadata.videoLabel}`,
    metadata.bibleVerses?.length
      ? `Known bible references: ${metadata.bibleVerses.join(", ")}`
      : null,
    `\nTranscript:\n${boundary.transcriptChunk}`,
  ]
    .filter(Boolean)
    .join("\n")

  console.log(
    JSON.stringify({
      event: "scene_analysis_start",
      startSeconds: boundary.startSeconds,
      endSeconds: boundary.endSeconds,
      frameCount: thumbnailUrls.length,
    }),
  )

  // Build multimodal message: thumbnail frames + text
  const imageContent: Array<{
    type: "image_url"
    image_url: { url: string }
  }> = thumbnailUrls.map((url) => ({
    type: "image_url" as const,
    image_url: { url },
  }))

  const response = await getOpenrouter().chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      { role: "system", content: SCENE_ANALYSIS_SYSTEM_PROMPT },
      {
        role: "user",
        content: [...imageContent, { type: "text", text: userText }],
      },
    ],
  })

  const inputTokens = response.usage?.prompt_tokens ?? 0
  const outputTokens = response.usage?.completion_tokens ?? 0
  const text = response.choices[0]?.message?.content ?? ""

  console.log(
    JSON.stringify({
      event: "scene_analysis_complete",
      startSeconds: boundary.startSeconds,
      inputTokens,
      outputTokens,
    }),
  )

  const output = parseLLMJson(
    text,
    geminiOutputSchema,
    EMPTY_SCENE_SIGNALS,
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

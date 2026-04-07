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
  inputQuality: z.enum(["good", "bad_frames"]).default("good"),
  themes: z.array(z.string()).default([]),
  bibleVerses: z.array(z.string()).default([]),
  content: z.string().default(""),
  tone: z.string().default(""),
  demographics: z.array(z.string()).default([]),
})

type RawSceneSignals = z.infer<typeof geminiOutputSchema>

const EMPTY_SCENE_SIGNALS: RawSceneSignals = {
  inputQuality: "good",
  themes: [],
  bibleVerses: [],
  content: "",
  tone: "",
  demographics: [],
}

/** JSON Schema for OpenRouter structured output — guarantees valid JSON response. */
const STRUCTURED_OUTPUT_SCHEMA = {
  name: "scene_analysis",
  strict: true,
  schema: {
    type: "object" as const,
    properties: {
      inputQuality: {
        type: "string" as const,
        enum: ["good", "bad_frames"],
        description:
          "Set to 'bad_frames' if the provided images are too dark, blurry, blank, or otherwise unusable for analysis. Set to 'good' if the frames are usable.",
      },
      themes: {
        type: "array" as const,
        items: { type: "string" as const },
        description: "2-5 felt needs/themes: forgiveness, hope, grief, etc.",
      },
      bibleVerses: {
        type: "array" as const,
        items: { type: "string" as const },
        description:
          "1-5 relevant scripture references in standard format like 'Matthew 6:14-15'.",
      },
      content: {
        type: "string" as const,
        description:
          "1-3 sentence narrative summary of the scene: dialogue, actions, message.",
      },
      tone: {
        type: "string" as const,
        description:
          "1-2 words: contemplative, joyful, grieving, urgent, peaceful, hopeful, etc.",
      },
      demographics: {
        type: "array" as const,
        items: { type: "string" as const },
        description:
          "Target audience if clearly evident (children, youth, adult, parent, etc.). Empty array if not clear.",
      },
    },
    required: [
      "inputQuality",
      "themes",
      "bibleVerses",
      "content",
      "tone",
      "demographics",
    ],
    additionalProperties: false,
  },
}

const SCENE_ANALYSIS_SYSTEM_PROMPT = `You are a ministry content analyst for JesusFilm. You will receive representative still frames from a video scene along with the transcript text for that scene.

IMPORTANT: First assess the provided images. If the frames are too dark, blank, blurry, or otherwise unusable, set inputQuality to "bad_frames" — still extract what you can from the transcript alone, but signal that better frames would improve the analysis.

Extract the following signals, ordered by importance:

1. **Felt needs / themes** (MOST IMPORTANT): What human need does this scene address? Examples: forgiveness, hope, grief, loneliness, identity, redemption, belonging, purpose, healing, doubt, courage, fear, reconciliation, guilt, mercy, faith, love, justice, peace, joy, patience, kindness. Return 2-5 themes.

2. **Bible verses**: Scripture references relevant to this scene's themes. Include any provided CMS references if they match, plus additional verses you identify. Use standard format like "Matthew 6:14-15". Return 1-5 verses.

3. **Content**: A 1-3 sentence narrative summary of what happens in the scene — the dialogue, actions, and message being communicated.

4. **Emotional tone**: One or two words describing the tone. Examples: contemplative, joyful, grieving, urgent, peaceful, hopeful, sorrowful, reverent, celebratory.

5. **Demographics** (ONLY if clearly evident): Target audience signals like age group (children, youth, young adult, adult, elderly) or life stage (student, parent, married, widowed). Leave empty array if not clearly applicable.`

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

  const MAX_ANALYSIS_RETRIES = 3
  let output: RawSceneSignals = EMPTY_SCENE_SIGNALS
  let inputTokens = 0
  let outputTokens = 0

  for (let attempt = 1; attempt <= MAX_ANALYSIS_RETRIES; attempt++) {
    // Shift thumbnail timestamps on retry to get different frames
    // attempt 1: standard 3 frames, attempt 2: offset by 25%, attempt 3: offset by 50%
    const sceneDuration =
      (boundary.endSeconds ?? boundary.startSeconds + 60) -
      boundary.startSeconds
    const offset = sceneDuration * (attempt - 1) * 0.15
    const shiftedStart = boundary.startSeconds + offset
    const shiftedEnd = boundary.endSeconds ? boundary.endSeconds - offset : null

    const thumbnailUrls = getSceneThumbnailUrls(
      playbackId,
      shiftedStart,
      shiftedEnd && shiftedEnd > shiftedStart ? shiftedEnd : null,
    )

    console.log(
      JSON.stringify({
        event: "scene_analysis_start",
        startSeconds: boundary.startSeconds,
        endSeconds: boundary.endSeconds,
        attempt,
        frameCount: thumbnailUrls.length,
        ...(attempt > 1
          ? { shiftedStart, shiftedEnd, reason: "bad_frames_retry" }
          : {}),
      }),
    )

    const imageContent: Array<{
      type: "image_url"
      image_url: { url: string }
    }> = thumbnailUrls.map((url) => ({
      type: "image_url" as const,
      image_url: { url },
    }))

    const response = await getOpenrouter().chat.completions.create({
      model: DEFAULT_MODEL,
      response_format: {
        type: "json_schema",
        json_schema: STRUCTURED_OUTPUT_SCHEMA,
      },
      messages: [
        { role: "system", content: SCENE_ANALYSIS_SYSTEM_PROMPT },
        {
          role: "user",
          content: [...imageContent, { type: "text", text: userText }],
        },
      ],
    })

    inputTokens += response.usage?.prompt_tokens ?? 0
    outputTokens += response.usage?.completion_tokens ?? 0
    const text = response.choices[0]?.message?.content ?? ""

    output = parseLLMJson(
      text,
      geminiOutputSchema,
      EMPTY_SCENE_SIGNALS,
      "scene_analysis",
    )

    const description = buildDescription(output)

    // If LLM signals bad frames and we have retries left, get different frames
    if (
      output.inputQuality === "bad_frames" &&
      attempt < MAX_ANALYSIS_RETRIES
    ) {
      console.warn(
        JSON.stringify({
          event: "scene_analysis_bad_frames",
          startSeconds: boundary.startSeconds,
          attempt,
          hasContent: description.trim().length > 0,
        }),
      )
      await new Promise((r) => setTimeout(r, 1000))
      continue
    }

    // If we got a usable description, we're done
    if (description.trim().length > 0) {
      break
    }

    // Empty description — retry with different temperature
    console.warn(
      JSON.stringify({
        event: "scene_analysis_empty_retry",
        startSeconds: boundary.startSeconds,
        attempt,
        inputQuality: output.inputQuality,
        parsedThemes: output.themes.length,
        parsedContent: output.content.length,
      }),
    )

    if (attempt < MAX_ANALYSIS_RETRIES) {
      await new Promise((r) => setTimeout(r, 2000 * attempt))
    }
  }

  console.log(
    JSON.stringify({
      event: "scene_analysis_complete",
      startSeconds: boundary.startSeconds,
      inputQuality: output.inputQuality,
      inputTokens,
      outputTokens,
    }),
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

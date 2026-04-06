// Gemini multimodal client — for video + text analysis via Google AI SDK.
// Parallel to openrouter.ts (text-only). Used by scene analysis (feat-040).

import { env } from "@/config/env"

let _gemini: Awaited<ReturnType<typeof createGeminiClient>> | undefined

async function createGeminiClient() {
  const { GoogleGenAI } = await import("@google/genai")
  return new GoogleGenAI({
    apiKey: env.GOOGLE_AI_API_KEY,
    httpOptions: {
      timeout: 180_000, // 3 minutes — video analysis is slower than text
    },
  })
}

export async function getGemini() {
  if (!_gemini) {
    _gemini = await createGeminiClient()
  }
  return _gemini
}

export const GEMINI_MODEL = "gemini-2.5-flash"

export type VideoSceneInput = {
  videoUrl: string
  mimeType?: string
  transcriptChunk: string
  startSeconds: number
  endSeconds: number | null
  chapterTitle: string | null
  metadata: {
    videoLabel: string
    bibleVerses?: string[]
  }
}

export type GeminiSceneResponse = {
  themes: string[]
  bibleVerses: string[]
  content: string
  tone: string
  demographics: string[]
}

const SCENE_ANALYSIS_PROMPT = `You are a ministry content analyst for JesusFilm. Analyze this video scene and extract structured signals.

The video shows a scene from a ministry film. You will also receive the transcript text for this scene and some metadata.

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

export async function analyzeVideoScene(
  input: VideoSceneInput,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const ai = await getGemini()

  const timeRange =
    input.endSeconds != null
      ? `from ${input.startSeconds}s to ${input.endSeconds}s`
      : `starting at ${input.startSeconds}s to the end`

  const userMessage = [
    `Scene time range: ${timeRange}`,
    input.chapterTitle ? `Chapter: ${input.chapterTitle}` : null,
    `Video type: ${input.metadata.videoLabel}`,
    input.metadata.bibleVerses?.length
      ? `Known bible references: ${input.metadata.bibleVerses.join(", ")}`
      : null,
    `\nTranscript:\n${input.transcriptChunk}`,
  ]
    .filter(Boolean)
    .join("\n")

  console.log(
    JSON.stringify({
      event: "gemini_scene_analysis_start",
      startSeconds: input.startSeconds,
      endSeconds: input.endSeconds,
    }),
  )

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            fileData: {
              fileUri: input.videoUrl,
              mimeType: input.mimeType ?? "video/mp4",
            },
          },
          { text: SCENE_ANALYSIS_PROMPT },
          { text: userMessage },
        ],
      },
    ],
  })

  const inputTokens = response.usageMetadata?.promptTokenCount ?? 0
  const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0
  const text = response.text ?? ""

  console.log(
    JSON.stringify({
      event: "gemini_scene_analysis_complete",
      startSeconds: input.startSeconds,
      inputTokens,
      outputTokens,
    }),
  )

  return { text, inputTokens, outputTokens }
}

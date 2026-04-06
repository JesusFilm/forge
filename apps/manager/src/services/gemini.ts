// Gemini multimodal client — for video + text analysis via Google AI SDK.
// Parallel to openrouter.ts (text-only). Used by scene analysis (feat-040).
//
// Video is uploaded to the Gemini Files API (not passed as a URL) because
// fileData.fileUri only accepts Google-hosted URIs (Files API or gs://).

import { env } from "@/config/env"

let _gemini: Awaited<ReturnType<typeof createGeminiClient>> | undefined

async function createGeminiClient() {
  if (!env.GOOGLE_AI_API_KEY) {
    throw new Error(
      "GOOGLE_AI_API_KEY is not configured — scene analysis requires a Google AI API key",
    )
  }

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

/**
 * Upload a video from a URL to the Gemini Files API, then use it in a
 * generateContent call. fileData.fileUri requires a Google-hosted URI,
 * so we must upload first rather than passing the Mux URL directly.
 */
export async function analyzeVideoScene(input: {
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
}): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
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

  // Download the video into a Blob, then upload to Gemini Files API.
  // The SDK's upload({ file }) expects a local path or Blob, not a URL.
  const mimeType = input.mimeType ?? "video/mp4"

  const videoResponse = await fetch(input.videoUrl, {
    signal: AbortSignal.timeout(120_000), // 2 minutes to download video
  })
  if (!videoResponse.ok) {
    throw new Error(
      `Failed to download video: ${videoResponse.status} ${videoResponse.statusText}`,
    )
  }
  const videoBlob = new Blob([await videoResponse.arrayBuffer()], {
    type: mimeType,
  })

  const uploadedFile = await ai.files.upload({
    file: videoBlob,
    config: { mimeType },
  })

  if (!uploadedFile.uri) {
    throw new Error("Gemini Files API upload returned no URI")
  }

  let response
  try {
    response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              fileData: {
                fileUri: uploadedFile.uri,
                mimeType,
              },
            },
            { text: SCENE_ANALYSIS_PROMPT },
            { text: userMessage },
          ],
        },
      ],
    })
  } finally {
    // Clean up uploaded file from Gemini Files API (20GB quota)
    if (uploadedFile.name) {
      ai.files.delete({ name: uploadedFile.name }).catch(() => {
        // Best-effort cleanup — don't fail the pipeline if delete fails
      })
    }
  }

  const inputTokens = response.usageMetadata?.promptTokenCount ?? 0
  const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0

  // response.text is a getter that returns undefined if no candidates
  let text = ""
  try {
    text = response.text ?? ""
  } catch {
    text = ""
  }

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

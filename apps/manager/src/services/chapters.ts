// Chapters service — automatic chapter segmentation from transcript.

import OpenAI from "openai"
import { env } from "@/config/env"
import { writeArtifact } from "@/services/storage"

const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: env.OPENROUTER_API_KEY,
})

export type Chapter = {
  title: string
  startSeconds: number
  endSeconds: number | null
  summary: string
}

export type ChaptersResult = {
  chapters: Chapter[]
}

export async function generateChapters(
  assetId: string,
  transcript: string,
): Promise<ChaptersResult> {
  const response = await openrouter.chat.completions.create({
    model: "google/gemini-2.5-flash",
    messages: [
      {
        role: "system",
        content: `You are a video content analyst. Given a transcript, identify logical chapter breaks.
Return a JSON object: { "chapters": [{ "title": string, "startSeconds": number, "endSeconds": number | null, "summary": string }] }
Return valid JSON only.`,
      },
      { role: "user", content: transcript },
    ],
  })

  const content = response.choices[0]?.message?.content ?? '{"chapters":[]}'

  let result: ChaptersResult
  try {
    result = JSON.parse(content) as ChaptersResult
  } catch {
    result = { chapters: [] }
  }

  await writeArtifact({
    assetId,
    artifactType: "chapters",
    ext: "json",
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  })

  return result
}

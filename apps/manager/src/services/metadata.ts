// Metadata service — extracts topics, speakers, themes, and tags from transcript.

import OpenAI from "openai"
import { env } from "@/config/env"
import { writeArtifact } from "@/services/storage"

const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: env.OPENROUTER_API_KEY,
})

export type VideoMetadata = {
  title: string
  description: string
  topics: string[]
  speakers: string[]
  tags: string[]
  language: string
}

export async function extractMetadata(
  assetId: string,
  transcript: string,
  language: string,
): Promise<VideoMetadata> {
  const response = await openrouter.chat.completions.create({
    model: "google/gemini-2.5-flash",
    messages: [
      {
        role: "system",
        content: `You are a content analysis expert. Given a video transcript, extract structured metadata.
Return a JSON object: { "title": string, "description": string, "topics": string[], "speakers": string[], "tags": string[], "language": string }
Return valid JSON only.`,
      },
      { role: "user", content: transcript },
    ],
  })

  const content = response.choices[0]?.message?.content ?? "{}"

  let result: VideoMetadata
  try {
    result = JSON.parse(content) as VideoMetadata
  } catch {
    result = {
      title: "",
      description: "",
      topics: [],
      speakers: [],
      tags: [],
      language,
    }
  }

  await writeArtifact({
    assetId,
    artifactType: "metadata",
    ext: "json",
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  })

  return result
}

// Metadata service — extracts topics, speakers, themes, and tags from transcript.

import { z } from "zod"
import { getOpenrouter, DEFAULT_MODEL } from "@/services/openrouter"
import { writeArtifact } from "@/services/storage"
import { parseLLMJson } from "@/lib/parseLLMJson"

export type VideoMetadata = {
  title: string
  description: string
  topics: string[]
  speakers: string[]
  tags: string[]
  language: string
}

const metadataSchema = z.object({
  title: z.string(),
  description: z.string(),
  topics: z.array(z.string()),
  speakers: z.array(z.string()),
  tags: z.array(z.string()),
  language: z.string(),
})

export async function extractMetadata(
  assetId: string,
  transcript: string,
  language: string,
): Promise<VideoMetadata> {
  const response = await getOpenrouter().chat.completions.create({
    model: DEFAULT_MODEL,
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
  const fallback: VideoMetadata = {
    title: "",
    description: "",
    topics: [],
    speakers: [],
    tags: [],
    language,
  }
  const result = parseLLMJson(content, metadataSchema, fallback, "metadata")

  await writeArtifact({
    assetId,
    artifactType: "metadata",
    ext: "json",
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  })

  return result
}

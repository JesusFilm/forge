// Metadata service — extracts topics, speakers, themes, and tags from transcript.

import { z } from "zod"
import {
  DEFAULT_MODEL,
  createStructuredOpenrouterOutput,
} from "@/services/openrouter"
import { writeArtifact } from "@/services/storage"

export type VideoMetadata = {
  title: string
  description: string
  topics: string[]
  speakers: string[]
  tags: string[]
  language: string
}

export type MetadataResult = VideoMetadata & {
  artifactKeys: string[]
}

const metadataSchema = z.object({
  title: z.string(),
  description: z.string(),
  topics: z.array(z.string()),
  speakers: z.array(z.string()),
  tags: z.array(z.string()),
  language: z.string(),
})

const metadataJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    topics: { type: "array", items: { type: "string" } },
    speakers: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
    language: { type: "string" },
  },
  required: ["title", "description", "topics", "speakers", "tags", "language"],
} satisfies Record<string, unknown>

function hasUsableMetadata(metadata: VideoMetadata): boolean {
  return (
    metadata.title.trim().length > 0 ||
    metadata.description.trim().length > 0 ||
    metadata.topics.length > 0 ||
    metadata.speakers.length > 0 ||
    metadata.tags.length > 0
  )
}

export async function extractMetadata(
  assetId: string,
  transcript: string,
  language: string,
): Promise<MetadataResult> {
  const result = await createStructuredOpenrouterOutput({
    context: "metadata",
    name: "video_metadata",
    schema: metadataSchema,
    jsonSchema: metadataJsonSchema,
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

  const normalizedResult: VideoMetadata = {
    ...result,
    language: result.language.trim() || language,
  }

  if (!hasUsableMetadata(normalizedResult)) {
    throw new Error("Metadata extraction produced no usable fields")
  }

  await writeArtifact({
    assetId,
    artifactType: "metadata",
    ext: "json",
    body: JSON.stringify(normalizedResult, null, 2),
    contentType: "application/json",
  })

  return {
    ...normalizedResult,
    artifactKeys: ["metadata"],
  }
}

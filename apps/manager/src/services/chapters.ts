// Chapters service — automatic chapter segmentation from transcript.

import { z } from "zod"
import { getOpenrouter, DEFAULT_MODEL } from "@/services/openrouter"
import { writeArtifact } from "@/services/storage"
import { parseLLMJson } from "@/lib/parseLLMJson"

export type Chapter = {
  title: string
  startSeconds: number
  endSeconds: number | null
  summary: string
}

export type ChaptersResult = {
  chapters: Chapter[]
  artifactKeys: string[]
}

const chaptersSchema = z.object({
  chapters: z.array(
    z.object({
      title: z.string(),
      startSeconds: z.number(),
      endSeconds: z.number().nullable(),
      summary: z.string(),
    }),
  ),
})

function assertNonEmptyChapters(result: { chapters: Chapter[] }) {
  if (result.chapters.length === 0) {
    throw new Error("Chapter extraction produced no chapters")
  }
}

export async function generateChapters(
  assetId: string,
  transcript: string,
): Promise<ChaptersResult> {
  const response = await getOpenrouter().chat.completions.create({
    model: DEFAULT_MODEL,
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
  const result = parseLLMJson(
    content,
    chaptersSchema,
    { chapters: [] },
    "chapters",
  )
  assertNonEmptyChapters(result)

  await writeArtifact({
    assetId,
    artifactType: "chapters",
    ext: "json",
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  })

  return {
    ...result,
    artifactKeys: ["chapters"],
  }
}

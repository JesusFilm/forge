// POST /api/scene-analysis — Run scene analysis pipeline for a video.
// Decoupled from the enrichment workflow. Consumes existing subtitle data
// from the CMS and Mux video for multimodal Gemini analysis.

import { after } from "next/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { authenticateRequest } from "@/lib/auth"
import { runSceneAnalysisPipeline } from "@/workflows/sceneAnalysisPipeline"

const singleVideoSchema = z.object({
  videoId: z.number(),
  assetId: z.string().min(1),
  muxAssetId: z.string().min(1),
  subtitleUrl: z.string().url(),
  videoLabel: z.string().min(1),
  bibleVerses: z.array(z.string()).optional(),
})

export async function POST(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = singleVideoSchema.safeParse(rawBody)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const input = parsed.data

  // Run pipeline in background after response
  after(async () => {
    try {
      await runSceneAnalysisPipeline(input)
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "scene_pipeline_error",
          videoId: input.videoId,
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      )
    }
  })

  return NextResponse.json(
    {
      status: "accepted",
      videoId: input.videoId,
      message: "Scene analysis pipeline started",
    },
    { status: 202 },
  )
}

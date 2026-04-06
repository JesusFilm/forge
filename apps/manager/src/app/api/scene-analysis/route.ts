// POST /api/scene-analysis — Run scene analysis pipeline for a video.
// Decoupled from the enrichment workflow. Consumes existing subtitle data
// from the CMS and Mux video for multimodal Gemini analysis.
//
// Accepts: { videoId, assetId, muxAssetId, subtitleUrl, videoLabel, bibleVerses? }
// Or: { videoIds: string[] } to batch-process multiple videos by core ID (looks up data from CMS).

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

  const rawBody: unknown = await request.json()
  const parsed = singleVideoSchema.safeParse(rawBody)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.issues },
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

  return NextResponse.json({
    status: "accepted",
    videoId: input.videoId,
    message: "Scene analysis pipeline started",
  })
}

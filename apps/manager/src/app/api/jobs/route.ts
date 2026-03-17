import { NextResponse } from "next/server"
import { createJob, listJobs } from "@/lib/state"
import { createMuxAsset } from "@/services/mux"
import { runVideoEnrichment } from "@/workflows/videoEnrichment"

export async function GET() {
  const jobs = await listJobs()
  return NextResponse.json({ jobs })
}

type CreateJobBody = {
  inputUrl: string
  language?: string
  translateTo?: string[]
}

export async function POST(request: Request) {
  const body = (await request.json()) as CreateJobBody

  if (!body.inputUrl) {
    return NextResponse.json({ error: "inputUrl is required" }, { status: 400 })
  }

  // Create Mux asset
  const muxAsset = await createMuxAsset({
    inputUrl: body.inputUrl,
    generateSubtitles: true,
  })

  // Create local job record
  const job = await createJob(muxAsset.assetId, muxAsset.playbackId)

  // Kick off enrichment in the background (non-blocking)
  runVideoEnrichment({
    jobId: job.id,
    assetId: job.assetId,
    muxAssetId: muxAsset.assetId,
    language: body.language,
    translateTo: body.translateTo,
  }).catch(async (error: unknown) => {
    const { updateJob } = await import("@/lib/state")
    await updateJob(job.id, {
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
    })
  })

  return NextResponse.json({ job }, { status: 201 })
}

import { NextResponse } from "next/server"

import { authenticateRequest } from "@/lib/auth"
import { readEngineStamp } from "@/lib/engine-stamp"
import { getJob, updateJob } from "@/lib/state"
import { isAudioCleanupConfigured } from "@/services/audioCleanup"
import { launchVideoEnrichment } from "@/workflows/launchVideoEnrichment"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const { id } = await params
  const job = await getJob(id)
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }

  if (readEngineStamp(job.options) !== "mastra") {
    return NextResponse.json(
      { error: "Only mastra-stamped jobs can be redispatched" },
      { status: 409 },
    )
  }

  try {
    const result = await launchVideoEnrichment({
      jobId: job.id,
      assetId: job.muxAssetId,
      muxAssetId: job.muxAssetId,
      playbackId: job.muxPlaybackId,
      language: job.sourceLanguageCode,
      translateTo: job.languages,
      runAudioCleanup: isAudioCleanupConfigured(),
      initialArtifacts: job.artifacts,
      videoDocumentId: job.videoDocumentId,
      requestedTranscriptionProvider: "automatic",
    })

    return NextResponse.json(
      { jobId: job.id, dispatch: result },
      { status: 202 },
    )
  } catch (error) {
    await updateJob(job.id, { status: "failed", currentStep: undefined }).catch(
      console.error,
    )

    return NextResponse.json(
      {
        error: "Failed to redispatch enrichment workflow.",
        details: error instanceof Error ? error.message : undefined,
        code: "workflow_redispatch_failed",
      },
      { status: 502 },
    )
  }
}

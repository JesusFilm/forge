// POST /api/smart-crop/jobs/[id]/retry — relaunch the durable workflow for a
// failed smart-crop job. Steps are idempotent (artifact reuse), so completed
// work is skipped; failed steps are reset to pending. Job error history is
// kept — a retry note is appended instead of clearing errors.
//
// Plan 2026-06-09-002 "API routes".

import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"
import { getJob, updateJob } from "@/lib/state"
import type { JobStepState } from "@/types/job"

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

  const smartCrop = job.options.smartCrop
  if (!smartCrop) {
    return NextResponse.json(
      { error: "Job is not a smart-crop job" },
      { status: 409 },
    )
  }

  if (job.status !== "failed") {
    return NextResponse.json(
      { error: `Only failed jobs can be retried (job status: ${job.status})` },
      { status: 409 },
    )
  }

  if (!job.muxPlaybackId) {
    return NextResponse.json(
      { error: "Job has no stored Mux playback ID to retry against" },
      { status: 409 },
    )
  }

  if (
    smartCrop.kind === "localized" &&
    (!smartCrop.canonicalAssetId || !smartCrop.language)
  ) {
    return NextResponse.json(
      {
        error:
          "Localized smart-crop job options are missing canonicalAssetId/language",
      },
      { status: 409 },
    )
  }

  const now = new Date().toISOString()
  const failedSteps = job.steps.filter((step) => step.status === "failed")
  const steps: JobStepState[] = job.steps.map((step) =>
    step.status === "failed"
      ? {
          ...step,
          status: "pending",
          error: undefined,
          startedAt: undefined,
          finishedAt: undefined,
        }
      : step,
  )
  const noteStep =
    failedSteps[0]?.name ?? job.currentStep ?? "smart_crop_fingerprint"
  const errors = [
    ...job.errors,
    { step: noteStep, message: "Retry requested by operator", at: now },
  ]

  await updateJob(job.id, { status: "running", steps, errors })

  try {
    const { launchSmartCrop } = await import("@/workflows/launchSmartCrop")
    if (smartCrop.kind === "localized") {
      await launchSmartCrop({
        kind: "localized",
        jobId: job.id,
        assetId: smartCrop.assetId,
        muxAssetId: job.muxAssetId,
        playbackId: job.muxPlaybackId,
        cropMode: smartCrop.cropMode,
        model: smartCrop.model,
        force: false,
        canonicalAssetId: smartCrop.canonicalAssetId ?? "",
        language: smartCrop.language ?? "",
      })
    } else {
      await launchSmartCrop({
        kind: "canonical",
        jobId: job.id,
        assetId: smartCrop.assetId,
        muxAssetId: job.muxAssetId,
        playbackId: job.muxPlaybackId,
        cropMode: smartCrop.cropMode,
        model: smartCrop.model,
        force: false,
      })
    }
  } catch (error) {
    console.error(
      `[smart-crop] event=retry_launch_failed jobId=${job.id} error=${
        error instanceof Error ? error.message : "unknown"
      }`,
    )
    await updateJob(job.id, { status: "failed" }).catch(() => null)
    return NextResponse.json(
      { error: "Failed to relaunch the smart-crop workflow" },
      { status: 500 },
    )
  }

  console.log(`[smart-crop] event=retry_accepted jobId=${job.id}`)

  return NextResponse.json({ ok: true }, { status: 202 })
}

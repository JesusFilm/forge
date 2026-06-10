// POST /api/smart-crop/jobs/[id]/retry — relaunch the durable workflow for a
// failed smart-crop job. Steps are idempotent (artifact reuse), so completed
// work is skipped; failed steps are reset to pending. Job error history is
// kept — a retry note is appended instead of clearing errors.
//
// Body is optional: `{ "force": true }` opts the relaunch out of artifact
// reuse (every step recomputes — the escape hatch for deterministic re-fails
// such as a stored QA verdict "fail" or an alignment gate failure). The UI's
// bodiless POST keeps today's force:false behavior.
//
// Plan 2026-06-09-002 "API routes".

import { NextResponse } from "next/server"
import { z } from "zod"
import { authenticateRequest } from "@/lib/auth"
import { getJob, updateJob } from "@/lib/state"
import type { JobStepState } from "@/types/job"

const retryBodySchema = z.object({ force: z.boolean().optional() })

// In-memory double-submit guard: a second retry for the same job while one is
// being launched gets a 409 instead of a duplicate workflow run. TTL bounds
// staleness if an entry somehow outlives its request.
const RETRY_IN_FLIGHT_TTL_MS = 30_000
const retryInFlight = new Map<string, number>()

function claimRetrySlot(jobId: string): boolean {
  const now = Date.now()
  const expiresAt = retryInFlight.get(jobId)
  if (expiresAt !== undefined && expiresAt > now) {
    return false
  }
  retryInFlight.set(jobId, now + RETRY_IN_FLIGHT_TTL_MS)
  return true
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const { id } = await params

  // Lenient body parse: the dashboard POSTs with no body at all.
  let force = false
  const rawText = await request.text()
  if (rawText.trim().length > 0) {
    let rawBody: unknown
    try {
      rawBody = JSON.parse(rawText) as unknown
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }
    const parsed = retryBodySchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      )
    }
    force = parsed.data.force ?? false
  }

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

  if (!claimRetrySlot(job.id)) {
    return NextResponse.json(
      {
        error: "A retry for this job is already in flight",
        reason: "already_in_flight",
      },
      { status: 409 },
    )
  }

  try {
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
          force,
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
          force,
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
  } finally {
    retryInFlight.delete(job.id)
  }

  console.log(
    `[smart-crop] event=retry_accepted jobId=${job.id} force=${force}`,
  )

  return NextResponse.json({ ok: true }, { status: 202 })
}

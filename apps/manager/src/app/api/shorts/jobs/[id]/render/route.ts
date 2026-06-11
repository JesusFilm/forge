// POST /api/shorts/jobs/[id]/render — launch the durable render workflow for
// a reviewable short (plan 2026-06-11-002 decision 2 lifecycle contract).
//
// The route is deliberately thin: phase gate + claim slot + launch. The
// render workflow resolves the props/propsHash itself from the CURRENT draft
// (hard-gating draft provenance) and reuses an existing identical render via
// propsHash, so the route passes nothing but the job id. requestedBy is NOT
// written into the report (single-writer rule — the workflow owns it); the
// acting operator is recorded in the event log line instead.

import { NextResponse } from "next/server"
import {
  authenticateManagerOverrideRequest,
  managerActorIdentity,
} from "@/lib/auth"
import { env } from "@/config/env"
import {
  claimShortsLaunchSlot,
  releaseShortsLaunchSlot,
} from "@/lib/shorts-claim"
import { readShortsReport } from "@/lib/shorts-report"
import { resetShortsStepsForLaunch } from "@/lib/workflow-steps"
import { getJob, updateJob } from "@/lib/state"
import type { ShortsPhase } from "@/types/job"

// Lifecycle contract: render launches are allowed from a reviewable or
// render-recoverable phase only — never while any workflow is running.
const RENDERABLE_PHASES: ReadonlySet<ShortsPhase> = new Set([
  "ready_for_review",
  "render_failed",
  "completed",
])

function getMissingShortsConfig(): string[] {
  const missing: string[] = []
  if (!env.SHORTS_WORKER_BASE_URL) missing.push("SHORTS_WORKER_BASE_URL")
  if (!env.SHORTS_WORKER_API_KEY) missing.push("SHORTS_WORKER_API_KEY")
  return missing
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await authenticateManagerOverrideRequest(request)
  if (actor instanceof NextResponse) return actor

  const { id } = await params

  const job = await getJob(id)
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }

  const shorts = job.options.shorts
  if (!shorts) {
    return NextResponse.json(
      { error: "Job is not a shorts job" },
      { status: 409 },
    )
  }

  const report = readShortsReport(job)
  const phase = report?.phase ?? "queued"
  if (!RENDERABLE_PHASES.has(phase)) {
    return NextResponse.json(
      {
        error: `Renders can only be launched from a reviewable short (phase: ${phase})`,
        reason: "phase_invalid",
        phase,
      },
      { status: 409 },
    )
  }

  const missingConfig = getMissingShortsConfig()
  if (missingConfig.length > 0) {
    return NextResponse.json(
      {
        error: "Shorts Studio is not configured on this Manager deployment",
        reason: "config_missing",
        messages: [`Missing env vars: ${missingConfig.join(", ")}`],
        retryable: false,
      },
      { status: 503 },
    )
  }

  // Double-launch guard, first line (the worker's render:{assetId}:{propsHash}
  // dedupe is the second): sync claim BEFORE any await, release in finally
  // wrapping the ENTIRE post-claim body so a sync throw cannot leak the slot.
  if (!claimShortsLaunchSlot(job.id)) {
    return NextResponse.json(
      {
        error: "A launch for this job is already in flight",
        reason: "already_in_flight",
      },
      { status: 409 },
    )
  }

  try {
    // Lifecycle contract: render launch resets/replaces the render-step
    // subset in place (prepare steps preserved, no duplicate rows) so the
    // workflow's step updates have rows to write into.
    await updateJob(job.id, {
      steps: resetShortsStepsForLaunch(job.steps, "render"),
    })

    const { launchShorts } = await import("@/workflows/launchShorts")
    await launchShorts("render", job.id)
  } catch (error) {
    console.error(
      `[shorts] event=render_launch_failed jobId=${job.id} error=${
        error instanceof Error ? error.message : "unknown"
      }`,
    )
    return NextResponse.json(
      {
        error: "Failed to launch the shorts render workflow",
        reason: "launch_failed",
        retryable: true,
      },
      { status: 500 },
    )
  } finally {
    releaseShortsLaunchSlot(job.id)
  }

  console.log(
    `[shorts] event=render_requested jobId=${job.id} assetId=${shorts.assetId} phase=${phase} actor=${managerActorIdentity(actor)}`,
  )

  return NextResponse.json({ launched: true }, { status: 202 })
}

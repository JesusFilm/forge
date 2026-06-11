// POST /api/shorts/jobs/[id]/retry — relaunch a shorts workflow per the
// lifecycle contract (plan 2026-06-11-002 decision 2). Shorts jobs gate on
// PHASE, not the generic `status === "failed"` retry rule — `completed` is
// not terminal for shorts (a completed prepare awaits review; a completed
// render can be re-rendered after edits).
//
// Body: optional `{ force?: "prepare" | "render" }`.
// - force:"prepare" regenerates the clip + captions (the documented
//   caption-edit discard — the prepare workflow's draft provenance reset).
// - force:"render" and no force are the same dispatch: phase-appropriate
//   relaunch. The render workflow has no force option by design — a plain
//   render relaunch already reuses an identical output via propsHash and
//   re-renders when the draft moved.

import { NextResponse } from "next/server"
import { z } from "zod"
import { authenticateRequest } from "@/lib/auth"
import { env } from "@/config/env"
import {
  claimShortsLaunchSlot,
  releaseShortsLaunchSlot,
} from "@/lib/shorts-claim"
import { readShortsReport } from "@/lib/shorts-report"
import { resetShortsStepsForLaunch } from "@/lib/workflow-steps"
import { getJob, updateJob } from "@/lib/state"
import type { ShortsPhase } from "@/types/job"

const retryBodySchema = z.object({
  force: z.enum(["prepare", "render"]).optional(),
})

// force:"prepare" is allowed from any phase that is not actively running a
// workflow — including ready_for_review and completed (re-cut captions).
const FORCE_PREPARE_PHASES: ReadonlySet<ShortsPhase> = new Set([
  "ready_for_review",
  "prepare_failed",
  "render_failed",
  "completed",
])

// Phase-appropriate relaunch targets for plain retries (and force:"render").
const RETRY_PREPARE_PHASES: ReadonlySet<ShortsPhase> = new Set([
  "prepare_failed",
])
const RETRY_RENDER_PHASES: ReadonlySet<ShortsPhase> = new Set([
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
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const { id } = await params

  // Lenient body parse: the dashboard may POST with no body at all
  // (smart-crop retry precedent).
  let force: "prepare" | "render" | undefined
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
    force = parsed.data.force
  }

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

  // Resolve the dispatch per the lifecycle contract.
  let kind: "prepare" | "render"
  let forcePrepare = false
  if (force === "prepare") {
    if (!FORCE_PREPARE_PHASES.has(phase)) {
      return NextResponse.json(
        {
          error: `force:"prepare" is not allowed while a workflow is running (phase: ${phase})`,
          reason: "phase_invalid",
          phase,
        },
        { status: 409 },
      )
    }
    kind = "prepare"
    forcePrepare = true
  } else if (RETRY_PREPARE_PHASES.has(phase)) {
    kind = "prepare"
  } else if (RETRY_RENDER_PHASES.has(phase)) {
    kind = "render"
  } else {
    return NextResponse.json(
      {
        error: `Retries are not allowed while a workflow is running (phase: ${phase})`,
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

  // Same slot as the render route (both launch workflows on this JobRecord):
  // sync claim before any await, release in finally (slot-leak guard).
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
    // Reset/replace the relaunched kind's step subset in place (lifecycle
    // contract — the other kind's steps are preserved as history).
    await updateJob(job.id, {
      steps: resetShortsStepsForLaunch(job.steps, kind),
    })

    const { launchShorts } = await import("@/workflows/launchShorts")
    if (kind === "prepare" && forcePrepare) {
      await launchShorts("prepare", job.id, { force: true })
    } else {
      await launchShorts(kind, job.id)
    }
  } catch (error) {
    console.error(
      `[shorts] event=retry_launch_failed jobId=${job.id} kind=${kind} error=${
        error instanceof Error ? error.message : "unknown"
      }`,
    )
    return NextResponse.json(
      {
        error: `Failed to relaunch the shorts ${kind} workflow`,
        reason: "launch_failed",
        retryable: true,
      },
      { status: 500 },
    )
  } finally {
    releaseShortsLaunchSlot(job.id)
  }

  console.log(
    `[shorts] event=retry_accepted jobId=${job.id} kind=${kind} force=${force ?? "none"} phase=${phase}`,
  )

  return NextResponse.json(
    {
      launched: true,
      kind,
      // force:"prepare" regenerates captions — the prepare workflow's draft
      // provenance reset discards operator caption edits (plan decision 4).
      ...(forcePrepare ? { discardsCaptionEdits: true } : {}),
    },
    { status: 202 },
  )
}

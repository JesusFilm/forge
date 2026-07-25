// POST /api/shorts/jobs/[id]/retry — relaunch a shorts workflow per the
// lifecycle contract (plan 2026-06-11-002 decision 2). Shorts jobs gate on
// PHASE, not the generic `status === "failed"` retry rule — `completed` is
// not terminal for shorts (a completed prepare awaits review; a completed
// render can be re-rendered after edits). One status-based exception: phase
// "queued" + job status "failed" means the create route's launch itself
// failed, and a plain retry relaunches prepare from scratch.
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
import {
  authenticateManagerOverrideRequest,
  managerActorIdentity,
} from "@/lib/auth"
import {
  claimShortsLaunchSlot,
  releaseShortsLaunchSlot,
} from "@/lib/shorts-claim"
import { requireShortsWorkerConfig } from "@/lib/shorts-config"
import { getShortsActiveStall } from "@/lib/shorts-stale"
import { readShortsReport } from "@/lib/shorts-report"
import { resetShortsStepsForLaunch } from "@/lib/workflow-steps"
import { getJob, updateJob } from "@/lib/state"
import type { JobRecord, ShortsPhase } from "@/types/job"

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

// Phases owned by an in-flight workflow ("queued" is the create route's
// launching intent). The exception: phase "queued" with job status "failed"
// means the create route's launch itself failed — nothing is running.
const WORKFLOW_IN_FLIGHT_PHASES: ReadonlySet<ShortsPhase> = new Set([
  "queued",
  "preparing",
  "rendering",
  "mux_processing",
])

// 409 copy must not claim "a workflow is running" for phases where none is
// (todo 010) — differentiate in-flight phases from settled-but-unretryable
// ones. `subject` reads as the start of the sentence ('Retries are' /
// 'force:"prepare" is').
function phaseInvalidResponse(
  subject: string,
  phase: ShortsPhase,
  jobStatus: JobRecord["status"],
): NextResponse {
  const workflowInFlight =
    WORKFLOW_IN_FLIGHT_PHASES.has(phase) &&
    !(phase === "queued" && jobStatus === "failed")
  return NextResponse.json(
    {
      error: workflowInFlight
        ? `${subject} not allowed while a workflow is running (phase: ${phase})`
        : `${subject} not allowed from phase ${phase}`,
      reason: "phase_invalid",
      phase,
    },
    { status: 409 },
  )
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Identity-returning auth (same credentials as authenticateRequest;
  // smart-crop approve precedent) so the audit note + log line record WHO
  // requested the retry.
  const actor = await authenticateManagerOverrideRequest(request)
  if (actor instanceof NextResponse) return actor

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
      { error: "Job is not a shorts job", reason: "not_shorts_job" },
      { status: 409 },
    )
  }

  const report = readShortsReport(job)
  const phase = report?.phase ?? "queued"
  const activeStall =
    job.status === "failed" ? null : getShortsActiveStall(job, report)

  // Resolve the dispatch per the lifecycle contract.
  let kind: "prepare" | "render"
  let forcePrepare = false
  if (force === "prepare") {
    if (!FORCE_PREPARE_PHASES.has(phase)) {
      return phaseInvalidResponse('force:"prepare" is', phase, job.status)
    }
    kind = "prepare"
    forcePrepare = true
  } else if (RETRY_PREPARE_PHASES.has(phase)) {
    kind = "prepare"
  } else if (activeStall) {
    kind = activeStall.retryKind
  } else if (phase === "queued" && job.status === "failed") {
    // The create route's workflow launch failed before any phase transition
    // (todo 010): no workflow ever ran, so a prepare from scratch is the
    // correct dispatch — otherwise the job is permanently unretryable.
    kind = "prepare"
  } else if (RETRY_RENDER_PHASES.has(phase)) {
    kind = "render"
  } else {
    return phaseInvalidResponse("Retries are", phase, job.status)
  }

  const configMissing = requireShortsWorkerConfig()
  if (configMissing) return configMissing

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

  const actorIdentity = managerActorIdentity(actor)

  try {
    // Reset/replace the relaunched kind's step subset in place (lifecycle
    // contract — the other kind's steps are preserved as history). Error
    // history is kept; an operator audit note records who requested the
    // retry (smart-crop retry precedent).
    await updateJob(job.id, {
      steps: resetShortsStepsForLaunch(job.steps, kind),
      errors: [
        ...job.errors,
        {
          step: kind === "prepare" ? "shorts_prepare" : "shorts_render",
          message: `Retry (${kind}) requested by ${actorIdentity}`,
          at: new Date().toISOString(),
        },
      ],
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
    `[shorts] event=retry_accepted jobId=${job.id} kind=${kind} force=${force ?? "none"} phase=${phase} actor=${actorIdentity}`,
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

// POST /api/shorts/jobs/[id]/draft — save the operator caption/knob draft
// (plan 2026-06-11-002 decision 4).
//
// Last-write-wins BY DESIGN: this is a 3-operator tool, lost tweaks are
// recoverable, and the optimistic-concurrency 409 ceremony was an explicit
// scope cut. `draftVersion` is incremented SERVER-SIDE on every save (the
// body cannot carry one) and mirrored into the shorts report so the UI's
// stale-output banner (draftVersion > lastRenderedDraftVersion) works.
//
// The body's draft is validated against the strict DraftSchema from
// @forge/shorts-compositions/schema — server-injected render fields
// (clipUrl/fps/clipDurationSec/hasAudio) are unrepresentable and any payload
// carrying them is rejected with 400 (plan decision 15). `updatedBy` is
// derived from the authenticated actor, never the body.

import { NextResponse } from "next/server"
import { z } from "zod"
import { draftSchema } from "@forge/shorts-compositions/schema"
import {
  authenticateManagerOverrideRequest,
  managerActorIdentity,
} from "@/lib/auth"
import { SHORTS_CAPTIONS_ARTIFACT_TYPE } from "@/lib/shorts-artifacts"
import {
  buildShortsMetadataArtifact,
  mergeShortsReport,
  readShortsReport,
} from "@/lib/shorts-report"
import { getJob, mergeJobArtifacts } from "@/lib/state"
import type { ShortsPhase } from "@/types/job"

// Top-level unknown keys (e.g. a client-supplied updatedBy/draftVersion) are
// IGNORED by default z.object semantics; unknown keys INSIDE draft are
// rejected by the strict draftSchema.
const saveDraftSchema = z.object({
  draft: draftSchema,
})

// Drafts may only move while the operator is reviewing — never while a
// workflow is running (queued/preparing/rendering/mux_processing) where a
// concurrent save could race the prepare draft seed or the render's
// provenance gate.
const DRAFT_EDITABLE_PHASES: ReadonlySet<ShortsPhase> = new Set([
  "ready_for_review",
  "render_failed",
  "completed",
])

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await authenticateManagerOverrideRequest(request)
  if (actor instanceof NextResponse) return actor

  const { id } = await params

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = saveDraftSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    )
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
  if (!DRAFT_EDITABLE_PHASES.has(phase)) {
    return NextResponse.json(
      {
        error: `Drafts can only be saved while the short is reviewable (phase: ${phase})`,
        reason: "phase_invalid",
        phase,
      },
      { status: 409 },
    )
  }

  // Provenance: the saved draft is stamped with the CURRENT captions
  // artifact's generatedAt — the render workflow refuses drafts built
  // against regenerated captions, and the prepare workflow uses the same
  // stamp to decide draft resets (plan decision 4).
  const { artifactExists, readArtifact } = await import("@/services/storage")
  const { parseShortsCaptionsArtifact } = await import("@/lib/shorts-artifacts")

  const captionsExist = await artifactExists(
    shorts.assetId,
    SHORTS_CAPTIONS_ARTIFACT_TYPE,
    "json",
  )
  if (!captionsExist) {
    return NextResponse.json(
      {
        error: `No captions artifact exists for ${shorts.assetId} yet — run prepare first`,
        reason: "captions_missing",
      },
      { status: 409 },
    )
  }

  let captionsGeneratedAt: string | null = null
  try {
    const captions = parseShortsCaptionsArtifact(
      JSON.parse(
        new TextDecoder().decode(
          await readArtifact(
            shorts.assetId,
            SHORTS_CAPTIONS_ARTIFACT_TYPE,
            "json",
          ),
        ),
      ) as unknown,
    )
    captionsGeneratedAt = captions?.generatedAt ?? null
  } catch {
    captionsGeneratedAt = null
  }
  if (captionsGeneratedAt === null) {
    return NextResponse.json(
      {
        error: `Captions artifact for ${shorts.assetId} is malformed — force prepare to regenerate it`,
        reason: "captions_missing",
      },
      { status: 409 },
    )
  }

  const { readShortsDraft, writeShortsDraft } =
    await import("@/lib/shorts-draft")

  const existing = await readShortsDraft(shorts.assetId)
  const draftVersion = (existing?.draftVersion ?? 0) + 1
  const updatedBy = managerActorIdentity(actor)

  await writeShortsDraft(shorts.assetId, {
    draftVersion,
    captionsGeneratedAt,
    updatedBy,
    updatedAt: new Date().toISOString(),
    draft: parsed.data.draft,
  })

  // draftVersion mirror only — phase is owned by the workflows (plan
  // decision 2, single-writer rule), and mergeShortsReport keeps it.
  await mergeJobArtifacts(
    job.id,
    buildShortsMetadataArtifact(mergeShortsReport(report, { draftVersion })),
  )

  console.log(
    `[shorts] event=draft_saved jobId=${job.id} assetId=${shorts.assetId} draftVersion=${draftVersion} actor=${updatedBy}`,
  )

  return NextResponse.json({ draftVersion })
}

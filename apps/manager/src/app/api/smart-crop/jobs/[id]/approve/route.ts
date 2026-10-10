// POST /api/smart-crop/jobs/[id]/approve — operator approval (or rejection)
// of a canonical smart-crop plan. Updates the plan artifact's `qa` block and
// mirrors `plan.approved` into the job's smartCrop metadata entry.
//
// Plan 2026-06-09-002: localized full renders require the canonical plan's
// qa.status === "approved".

import { NextResponse } from "next/server"
import { z } from "zod"
import {
  authenticateManagerOverrideRequest,
  managerActorIdentity,
} from "@/lib/auth"
import {
  buildSmartCropMetadataArtifact,
  getSmartCropReport,
} from "@/lib/smart-crop-report"
import { getJob, mergeJobArtifacts } from "@/lib/state"
import type { SmartCropJobReport } from "@/types/job"

const approveSchema = z.object({
  action: z.enum(["approve", "reject"]),
  attemptIndex: z.number().int().nonnegative().optional(),
  manifestDigest: z.string().min(1).optional(),
})

const SELECTABLE_ATTEMPT_STATUSES = new Set([
  "approved",
  "complete",
  "qa_unavailable",
])

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Identity-returning authenticator (same credentials as authenticateRequest;
  // precedent: mux-sync override) so the plan review records WHO acted instead
  // of a hardcoded constant.
  const actor = await authenticateManagerOverrideRequest(request)
  if (actor instanceof NextResponse) return actor

  const { id } = await params

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = approveSchema.safeParse(rawBody)
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

  const smartCrop = job.options.smartCrop
  if (!smartCrop) {
    return NextResponse.json(
      { error: "Job is not a smart-crop job" },
      { status: 409 },
    )
  }
  if (smartCrop.kind !== "canonical") {
    return NextResponse.json(
      { error: "Only canonical smart-crop plans can be approved" },
      { status: 409 },
    )
  }

  const { artifactExists, readArtifact, writeArtifact } =
    await import("@/services/storage")
  const smartCropArtifacts = await import("@/services/smartCrop")
  const {
    SMART_CROP_ATTEMPTS_ARTIFACT_TYPE,
    buildSmartCropAttemptsArtifact,
    parsePlanArtifact,
    parseSmartCropAttemptsArtifact,
  } = smartCropArtifacts

  let selectedAttemptIndex = parsed.data.attemptIndex ?? 0
  let selectedPlanArtifactType = "smart-crop-plan-9x16-v1"
  let attemptsArtifact: ReturnType<
    typeof parseSmartCropAttemptsArtifact
  > | null = null

  const attemptsExists = await artifactExists(
    smartCrop.assetId,
    SMART_CROP_ATTEMPTS_ARTIFACT_TYPE,
    "json",
  )
  if (attemptsExists) {
    attemptsArtifact = parseSmartCropAttemptsArtifact(
      JSON.parse(
        new TextDecoder().decode(
          await readArtifact(
            smartCrop.assetId,
            SMART_CROP_ATTEMPTS_ARTIFACT_TYPE,
            "json",
          ),
        ),
      ) as unknown,
    )
    if (!attemptsArtifact) {
      return NextResponse.json(
        { error: "Smart Crop attempt manifest is malformed" },
        { status: 409 },
      )
    }
    if (parsed.data.attemptIndex == null || !parsed.data.manifestDigest) {
      return NextResponse.json(
        {
          error:
            "Smart Crop attempt selection is required; refresh and try again",
        },
        { status: 409 },
      )
    }
    if (parsed.data.manifestDigest !== attemptsArtifact.manifestDigest) {
      return NextResponse.json(
        { error: "Smart Crop attempt manifest changed; refresh and try again" },
        { status: 409 },
      )
    }
    const selectedAttempt = attemptsArtifact.attempts.find(
      (attempt) => attempt.attemptIndex === selectedAttemptIndex,
    )
    if (!selectedAttempt) {
      return NextResponse.json(
        { error: "Selected Smart Crop attempt was not found" },
        { status: 409 },
      )
    }
    if (
      selectedAttempt &&
      !SELECTABLE_ATTEMPT_STATUSES.has(selectedAttempt.status)
    ) {
      return NextResponse.json(
        { error: "Selected Smart Crop attempt is not ready for review" },
        { status: 409 },
      )
    }
    if (selectedAttempt) {
      selectedPlanArtifactType = selectedAttempt.planArtifactType
    } else {
      selectedAttemptIndex = 0
    }
  } else if (parsed.data.attemptIndex != null) {
    return NextResponse.json(
      { error: "Smart Crop attempt manifest not found yet" },
      { status: 409 },
    )
  }

  const planArtifactExists = await artifactExists(
    smartCrop.assetId,
    selectedPlanArtifactType,
    "json",
  )
  if (!planArtifactExists) {
    return NextResponse.json(
      { error: "Canonical smart-crop plan artifact not found yet" },
      { status: 409 },
    )
  }

  const plan = parsePlanArtifact(
    JSON.parse(
      new TextDecoder().decode(
        await readArtifact(smartCrop.assetId, selectedPlanArtifactType, "json"),
      ),
    ) as unknown,
  )
  if (!plan) {
    return NextResponse.json(
      { error: "Canonical smart-crop plan artifact is malformed" },
      { status: 409 },
    )
  }

  const approvedBy = managerActorIdentity(actor)

  const qa = {
    status: parsed.data.action === "approve" ? "approved" : "rejected",
    approvedBy,
    approvedAt: new Date().toISOString(),
  } as const

  plan.qa = qa

  await writeArtifact({
    assetId: smartCrop.assetId,
    artifactType: selectedPlanArtifactType,
    ext: "json",
    body: JSON.stringify(plan, null, 2),
    contentType: "application/json",
  })

  if (
    parsed.data.action === "approve" &&
    selectedPlanArtifactType !== "smart-crop-plan-9x16-v1"
  ) {
    await writeArtifact({
      assetId: smartCrop.assetId,
      artifactType: "smart-crop-plan-9x16-v1",
      ext: "json",
      body: JSON.stringify(plan, null, 2),
      contentType: "application/json",
    })
  }

  let nextManifestDigest = attemptsArtifact?.manifestDigest
  if (attemptsArtifact) {
    const nextAttempts = attemptsArtifact.attempts.map((attempt) =>
      attempt.attemptIndex === selectedAttemptIndex
        ? { ...attempt, status: qa.status, updatedAt: qa.approvedAt }
        : attempt,
    )
    const nextManifest = buildSmartCropAttemptsArtifact({
      assetId: smartCrop.assetId,
      attempts: nextAttempts,
      selectedAttemptIndex,
    })
    nextManifestDigest = nextManifest.manifestDigest
    await writeArtifact({
      assetId: smartCrop.assetId,
      artifactType: SMART_CROP_ATTEMPTS_ARTIFACT_TYPE,
      ext: "json",
      body: JSON.stringify(nextManifest, null, 2),
      contentType: "application/json",
    })
  }

  const report: SmartCropJobReport = getSmartCropReport(job.artifacts) ?? {
    domain: "smart_crop",
    kind: "canonical",
    phase: job.status === "completed" ? "completed" : "queued",
  }
  report.plan = {
    segmentCount: plan.segments.length,
    approved: parsed.data.action === "approve",
  }
  if (attemptsArtifact) {
    report.attempts = {
      latestAttemptIndex: Math.max(
        ...attemptsArtifact.attempts.map((attempt) => attempt.attemptIndex),
      ),
      selectedAttemptIndex,
      maxRepairAttempts: attemptsArtifact.maxRepairAttempts,
      repairCount: attemptsArtifact.attempts.filter(
        (attempt) => attempt.source === "repair",
      ).length,
      manifestDigest: nextManifestDigest,
    }
  }
  await mergeJobArtifacts(job.id, buildSmartCropMetadataArtifact(report))

  console.log(
    `[smart-crop] event=plan_review jobId=${job.id} assetId=${smartCrop.assetId} action=${parsed.data.action} attempt=${selectedAttemptIndex}`,
  )

  return NextResponse.json({
    ok: true,
    qa,
    attemptIndex: selectedAttemptIndex,
    manifestDigest: nextManifestDigest,
  })
}

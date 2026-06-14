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
})

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
  const { parsePlanArtifact } = await import("@/services/smartCrop")

  const planArtifactExists = await artifactExists(
    smartCrop.assetId,
    "smart-crop-plan-9x16-v1",
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
        await readArtifact(
          smartCrop.assetId,
          "smart-crop-plan-9x16-v1",
          "json",
        ),
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
    artifactType: "smart-crop-plan-9x16-v1",
    ext: "json",
    body: JSON.stringify(plan, null, 2),
    contentType: "application/json",
  })

  const report: SmartCropJobReport = getSmartCropReport(job.artifacts) ?? {
    domain: "smart_crop",
    kind: "canonical",
    phase: job.status === "completed" ? "completed" : "queued",
  }
  report.plan = {
    segmentCount: plan.segments.length,
    approved: parsed.data.action === "approve",
  }
  await mergeJobArtifacts(job.id, buildSmartCropMetadataArtifact(report))

  console.log(
    `[smart-crop] event=plan_review jobId=${job.id} assetId=${smartCrop.assetId} action=${parsed.data.action}`,
  )

  return NextResponse.json({ ok: true, qa })
}

// Smart Crop durable workflows (plan 2026-06-09-002 "Manager surface").
//
// runSmartCropCanonical: fingerprint -> plan -> preview render -> QA.
// runSmartCropLocalized: fingerprint -> align -> preview render -> QA ->
//   full render -> Mux output.
//
// Uses the `workflow` package ("use workflow" / "use step" directives).
// Steps are idempotent: each checks artifactExists (and the `force` option)
// before recomputing; the Mux output step checks job metadata for an existing
// output asset id before creating a new one. Step args/results are journaled,
// so only SMALL payloads (ids, logical keys, scalars) cross step boundaries —
// never artifact contents.

import { buildDownloadableArtifactManifest } from "@/lib/job-artifacts"
import { buildSmartCropMetadataArtifact } from "@/lib/smart-crop-report"
import type {
  JobArtifactManifest,
  SmartCropCropMode,
  SmartCropJobReport,
  SmartCropKind,
  SmartCropQaVerdict,
  WorkflowStepName,
} from "@/types/job"
import {
  stepMergeJobArtifacts,
  stepUpdateJob,
  stepUpdateStepStatus,
} from "@/workflows/jobStateSteps"

const FINGERPRINT_POLL_TIMEOUT_MS = 30 * 60_000
const PREVIEW_RENDER_POLL_TIMEOUT_MS = 30 * 60_000
const FULL_RENDER_POLL_TIMEOUT_MS = 6 * 60 * 60_000
const MUX_OUTPUT_POLL_TIMEOUT_MS = 10 * 60_000
const MUX_OUTPUT_POLL_INTERVAL_MS = 10_000
const QA_FRAME_PRESIGN_TTL_SECONDS = 3_600
const OUTPUT_PRESIGN_TTL_SECONDS = 7_200
const PREVIEW_FRAME_COUNT = 6

const STORAGE_PRESIGN_UNAVAILABLE =
  "storage_presign_unavailable: artifact presigning requires RAILWAY_S3_* configuration"

export class SmartCropStepError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "SmartCropStepError"
  }
}

export type SmartCropCanonicalWorkflowInput = {
  jobId: string
  assetId: string
  muxAssetId: string
  playbackId: string
  cropMode: SmartCropCropMode
  model?: string
  force?: boolean
}

export type SmartCropLocalizedWorkflowInput =
  SmartCropCanonicalWorkflowInput & {
    canonicalAssetId: string
    language: string
  }

type SmartCropUsageTotals = { inputTokens: number; outputTokens: number }

// ---------------------------------------------------------------------------
// Workflow-body helpers (plain async functions calling "use step" functions)
// ---------------------------------------------------------------------------

async function markStepRunning(jobId: string, step: WorkflowStepName) {
  await stepUpdateStepStatus(jobId, step, "running")
  await stepUpdateJob(jobId, { status: "running", currentStep: step })
}

async function markStepComplete(jobId: string, step: WorkflowStepName) {
  await stepUpdateStepStatus(jobId, step, "completed")
}

async function markStepSkipped(
  jobId: string,
  step: WorkflowStepName,
  note?: string,
) {
  if (note === undefined) {
    await stepUpdateStepStatus(jobId, step, "skipped")
    return
  }

  await stepUpdateStepStatus(jobId, step, "skipped", note)
}

async function markStepFailed(
  jobId: string,
  step: WorkflowStepName,
  error: string,
) {
  await stepUpdateStepStatus(jobId, step, "failed", error)
}

async function persistMergedArtifacts(
  jobId: string,
  artifacts: JobArtifactManifest,
): Promise<void> {
  if (Object.keys(artifacts).length === 0) {
    return
  }

  const updated = await stepMergeJobArtifacts(jobId, artifacts)
  if (!updated) {
    throw new Error(`Failed to persist artifact manifest for job ${jobId}`)
  }
}

async function persistReport(
  jobId: string,
  report: SmartCropJobReport,
): Promise<void> {
  await persistMergedArtifacts(jobId, buildSmartCropMetadataArtifact(report))
}

function addUsage(
  report: SmartCropJobReport,
  usage: SmartCropUsageTotals,
): void {
  const current = report.usage ?? { inputTokens: 0, outputTokens: 0 }
  report.usage = {
    inputTokens: current.inputTokens + usage.inputTokens,
    outputTokens: current.outputTokens + usage.outputTokens,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error"
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

export async function runSmartCropCanonical(
  input: SmartCropCanonicalWorkflowInput,
): Promise<void> {
  "use workflow"

  console.log(
    `[smart-crop] event=workflow_start kind=canonical jobId=${input.jobId} assetId=${input.assetId}`,
  )

  const report: SmartCropJobReport = {
    domain: "smart_crop",
    kind: "canonical",
    phase: "fingerprint",
  }

  await stepUpdateJob(input.jobId, {
    status: "running",
    startedAt: new Date().toISOString(),
  })

  try {
    await runFingerprintPhase(input, report)
    await runPlanPhase(input, report)
    await runPreviewRenderPhase(input, report, {
      kind: "canonical",
      cropPlanAssetId: input.assetId,
    })
    await runQaPhase(input, report, { cropPlanAssetId: input.assetId })

    await completeJob(input.jobId, report)
  } catch (error) {
    await failJob(input.jobId, report, error)
    throw error
  }
}

export async function runSmartCropLocalized(
  input: SmartCropLocalizedWorkflowInput,
): Promise<void> {
  "use workflow"

  console.log(
    `[smart-crop] event=workflow_start kind=localized jobId=${input.jobId} assetId=${input.assetId} canonicalAssetId=${input.canonicalAssetId} language=${input.language}`,
  )

  const report: SmartCropJobReport = {
    domain: "smart_crop",
    kind: "localized",
    phase: "fingerprint",
  }

  await stepUpdateJob(input.jobId, {
    status: "running",
    startedAt: new Date().toISOString(),
  })

  try {
    await runFingerprintPhase(input, report)
    await runAlignPhase(input, report)
    await runPreviewRenderPhase(input, report, {
      kind: "localized",
      cropPlanAssetId: input.canonicalAssetId,
    })
    await runQaPhase(input, report, {
      cropPlanAssetId: input.canonicalAssetId,
    })
    await runFullRenderPhase(input, report)
    await runMuxOutputPhase(input, report)

    await completeJob(input.jobId, report)
  } catch (error) {
    await failJob(input.jobId, report, error)
    throw error
  }
}

async function completeJob(
  jobId: string,
  report: SmartCropJobReport,
): Promise<void> {
  report.phase = "completed"
  await persistReport(jobId, report)
  await stepUpdateJob(jobId, {
    status: "completed",
    currentStep: undefined,
    completedAt: new Date().toISOString(),
  })
  console.log(`[smart-crop] event=workflow_complete jobId=${jobId}`)
}

async function failJob(
  jobId: string,
  report: SmartCropJobReport,
  error: unknown,
): Promise<void> {
  const message = errorMessage(error)
  console.error(
    `[smart-crop] event=workflow_error jobId=${jobId} error=${message}`,
  )

  report.phase = "failed"
  try {
    await persistReport(jobId, report)
  } catch (persistError) {
    console.error(
      `[smart-crop] event=report_persist_failed jobId=${jobId} error=${errorMessage(persistError)}`,
    )
  }

  await stepUpdateJob(jobId, { status: "failed", currentStep: undefined })
}

// ---------------------------------------------------------------------------
// Phases (markRunning -> step -> manifest/report merge -> markComplete/Failed)
// ---------------------------------------------------------------------------

async function runFingerprintPhase(
  input: SmartCropCanonicalWorkflowInput,
  report: SmartCropJobReport,
): Promise<void> {
  await markStepRunning(input.jobId, "smart_crop_fingerprint")
  report.phase = "fingerprint"
  await persistReport(input.jobId, report)

  try {
    const result = await stepSmartCropFingerprint({
      jobId: input.jobId,
      assetId: input.assetId,
      playbackId: input.playbackId,
      force: input.force ?? false,
    })
    await persistMergedArtifacts(
      input.jobId,
      buildDownloadableArtifactManifest(["smart-crop-fingerprint"]),
    )
    if (result.skipped) {
      await markStepSkipped(input.jobId, "smart_crop_fingerprint")
    } else {
      await markStepComplete(input.jobId, "smart_crop_fingerprint")
    }
  } catch (error) {
    await markStepFailed(
      input.jobId,
      "smart_crop_fingerprint",
      errorMessage(error),
    )
    throw error
  }
}

async function runPlanPhase(
  input: SmartCropCanonicalWorkflowInput,
  report: SmartCropJobReport,
): Promise<void> {
  await markStepRunning(input.jobId, "smart_crop_plan")
  report.phase = "plan"
  await persistReport(input.jobId, report)

  try {
    const result = await stepSmartCropPlan({
      jobId: input.jobId,
      assetId: input.assetId,
      muxAssetId: input.muxAssetId,
      playbackId: input.playbackId,
      cropMode: input.cropMode,
      model: input.model,
      force: input.force ?? false,
    })
    report.plan = {
      segmentCount: result.segmentCount,
      approved: result.approved,
    }
    addUsage(report, result.usage)
    await persistReport(input.jobId, report)
    await persistMergedArtifacts(
      input.jobId,
      buildDownloadableArtifactManifest(["smart-crop-plan"]),
    )
    if (result.skipped) {
      await markStepSkipped(input.jobId, "smart_crop_plan")
    } else {
      await markStepComplete(input.jobId, "smart_crop_plan")
    }
  } catch (error) {
    await markStepFailed(input.jobId, "smart_crop_plan", errorMessage(error))
    throw error
  }
}

async function runAlignPhase(
  input: SmartCropLocalizedWorkflowInput,
  report: SmartCropJobReport,
): Promise<void> {
  await markStepRunning(input.jobId, "smart_crop_align")
  report.phase = "align"
  await persistReport(input.jobId, report)

  let result: Awaited<ReturnType<typeof stepSmartCropAlign>>
  try {
    result = await stepSmartCropAlign({
      jobId: input.jobId,
      assetId: input.assetId,
      canonicalAssetId: input.canonicalAssetId,
      language: input.language,
      force: input.force ?? false,
    })
  } catch (error) {
    await markStepFailed(input.jobId, "smart_crop_align", errorMessage(error))
    throw error
  }

  // The alignment summary lands in metadata whether or not the gate passed —
  // gate failures must be operator-actionable, not silent.
  report.alignment = {
    overallConfidence: result.overallConfidence,
    unmappedDurationPercent: result.unmappedDurationPercent,
    gatePassed: result.gatePassed,
  }
  await persistReport(input.jobId, report)
  await persistMergedArtifacts(
    input.jobId,
    buildDownloadableArtifactManifest(["smart-crop-timeline-map"]),
  )

  if (!result.gatePassed) {
    const message = `Alignment confidence gates failed: ${
      result.gateFailures.length > 0
        ? result.gateFailures.join("; ")
        : "no gate details reported"
    }`
    await markStepFailed(input.jobId, "smart_crop_align", message)
    throw new SmartCropStepError("alignment_gate_failed", message)
  }

  if (result.skipped) {
    await markStepSkipped(input.jobId, "smart_crop_align")
  } else {
    await markStepComplete(input.jobId, "smart_crop_align")
  }
}

async function runPreviewRenderPhase(
  input: SmartCropCanonicalWorkflowInput,
  report: SmartCropJobReport,
  options: { kind: SmartCropKind; cropPlanAssetId: string },
): Promise<void> {
  await markStepRunning(input.jobId, "smart_crop_preview_render")
  report.phase = "preview_render"
  await persistReport(input.jobId, report)

  try {
    const result = await stepSmartCropPreviewRender({
      jobId: input.jobId,
      assetId: input.assetId,
      playbackId: input.playbackId,
      kind: options.kind,
      cropPlanAssetId: options.cropPlanAssetId,
      force: input.force ?? false,
    })
    await persistMergedArtifacts(
      input.jobId,
      buildDownloadableArtifactManifest([
        "smart-crop-preview",
        "smart-crop-render-report-preview",
        ...result.previewFrameKeys,
      ]),
    )
    if (result.skipped) {
      await markStepSkipped(input.jobId, "smart_crop_preview_render")
    } else {
      await markStepComplete(input.jobId, "smart_crop_preview_render")
    }
  } catch (error) {
    await markStepFailed(
      input.jobId,
      "smart_crop_preview_render",
      errorMessage(error),
    )
    throw error
  }
}

async function runQaPhase(
  input: SmartCropCanonicalWorkflowInput,
  report: SmartCropJobReport,
  options: { cropPlanAssetId: string },
): Promise<void> {
  await markStepRunning(input.jobId, "smart_crop_qa")
  report.phase = "qa"
  await persistReport(input.jobId, report)

  let result: Awaited<ReturnType<typeof stepSmartCropQa>>
  try {
    result = await stepSmartCropQa({
      jobId: input.jobId,
      assetId: input.assetId,
      cropPlanAssetId: options.cropPlanAssetId,
      model: input.model,
      force: input.force ?? false,
    })
  } catch (error) {
    await markStepFailed(input.jobId, "smart_crop_qa", errorMessage(error))
    throw error
  }

  if (result.outcome === "presign_unavailable") {
    await markStepSkipped(
      input.jobId,
      "smart_crop_qa",
      STORAGE_PRESIGN_UNAVAILABLE,
    )
    return
  }

  report.qa = { verdict: result.verdict }
  if (result.usage) {
    addUsage(report, result.usage)
  }
  await persistReport(input.jobId, report)
  await persistMergedArtifacts(
    input.jobId,
    buildDownloadableArtifactManifest(["smart-crop-qa"]),
  )

  if (result.verdict === "fail") {
    const message = `Smart Crop QA verdict: fail (${result.issueCount} issue${result.issueCount === 1 ? "" : "s"})`
    await markStepFailed(input.jobId, "smart_crop_qa", message)
    throw new SmartCropStepError("qa_failed", message)
  }

  if (result.outcome === "exists") {
    await markStepSkipped(input.jobId, "smart_crop_qa")
  } else {
    await markStepComplete(input.jobId, "smart_crop_qa")
  }
}

async function runFullRenderPhase(
  input: SmartCropLocalizedWorkflowInput,
  report: SmartCropJobReport,
): Promise<void> {
  await markStepRunning(input.jobId, "smart_crop_render")
  report.phase = "render"
  await persistReport(input.jobId, report)

  try {
    const result = await stepSmartCropFullRender({
      jobId: input.jobId,
      assetId: input.assetId,
      playbackId: input.playbackId,
      canonicalAssetId: input.canonicalAssetId,
      force: input.force ?? false,
    })
    await persistMergedArtifacts(
      input.jobId,
      buildDownloadableArtifactManifest([
        "smart-crop-output",
        "smart-crop-render-report-full",
      ]),
    )
    if (result.skipped) {
      await markStepSkipped(input.jobId, "smart_crop_render")
    } else {
      await markStepComplete(input.jobId, "smart_crop_render")
    }
  } catch (error) {
    await markStepFailed(input.jobId, "smart_crop_render", errorMessage(error))
    throw error
  }
}

async function runMuxOutputPhase(
  input: SmartCropLocalizedWorkflowInput,
  report: SmartCropJobReport,
): Promise<void> {
  await markStepRunning(input.jobId, "smart_crop_mux_output")
  report.phase = "mux_output"
  await persistReport(input.jobId, report)

  let result: Awaited<ReturnType<typeof stepSmartCropMuxOutput>>
  try {
    result = await stepSmartCropMuxOutput({
      jobId: input.jobId,
      assetId: input.assetId,
    })
  } catch (error) {
    await markStepFailed(
      input.jobId,
      "smart_crop_mux_output",
      errorMessage(error),
    )
    throw error
  }

  if (result.outcome === "presign_unavailable") {
    await markStepSkipped(
      input.jobId,
      "smart_crop_mux_output",
      STORAGE_PRESIGN_UNAVAILABLE,
    )
    return
  }

  report.output = {
    muxAssetId: result.muxAssetId,
    playbackId: result.playbackId,
  }
  await persistReport(input.jobId, report)

  if (result.outcome === "exists") {
    await markStepSkipped(input.jobId, "smart_crop_mux_output")
  } else {
    await markStepComplete(input.jobId, "smart_crop_mux_output")
  }
}

// ---------------------------------------------------------------------------
// Steps ("use step" — dynamic imports of heavy services, small journaled
// args/results)
// ---------------------------------------------------------------------------

async function readJsonArtifact(
  assetId: string,
  artifactType: string,
): Promise<unknown> {
  const { readArtifact } = await import("@/services/storage")
  const bytes = await readArtifact(assetId, artifactType, "json")
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

async function stepSmartCropFingerprint(args: {
  jobId: string
  assetId: string
  playbackId: string
  force: boolean
}): Promise<{ skipped: boolean }> {
  "use step"
  const { artifactExists } = await import("@/services/storage")
  const { shouldSkipWhenArtifactExists } = await import("@/services/smartCrop")

  const exists = await artifactExists(
    args.assetId,
    "smart-crop-fingerprint-v1",
    "json",
  )
  if (shouldSkipWhenArtifactExists(exists, args.force)) {
    return { skipped: true }
  }

  const { runCropWorkerJob } = await import("@/services/crop-worker")
  const { getPlaybackUrl } = await import("@/services/mux")

  const result = await runCropWorkerJob({
    body: {
      kind: "fingerprint",
      jobId: args.jobId,
      assetId: args.assetId,
      source: { url: getPlaybackUrl(args.playbackId) },
    },
    pollTimeoutMs: FINGERPRINT_POLL_TIMEOUT_MS,
  })

  if (!result.ok) {
    throw new SmartCropStepError(
      result.reason,
      `crop-worker fingerprint failed (${result.reason}): ${result.messages.join("; ")}`,
    )
  }

  return { skipped: false }
}

async function stepSmartCropPlan(args: {
  jobId: string
  assetId: string
  muxAssetId: string
  playbackId: string
  cropMode: SmartCropCropMode
  model?: string
  force: boolean
}): Promise<{
  skipped: boolean
  segmentCount: number
  approved: boolean
  usage: SmartCropUsageTotals
}> {
  "use step"
  const { artifactExists, writeArtifact } = await import("@/services/storage")
  const smartCrop = await import("@/services/smartCrop")

  const exists = await artifactExists(
    args.assetId,
    "smart-crop-plan-9x16-v1",
    "json",
  )
  if (smartCrop.shouldSkipWhenArtifactExists(exists, args.force)) {
    const existing = smartCrop.parsePlanArtifact(
      await readJsonArtifact(args.assetId, "smart-crop-plan-9x16-v1"),
    )
    return {
      skipped: true,
      segmentCount: existing?.segments.length ?? 0,
      approved: existing?.qa.status === "approved",
      usage: existing?.usage ?? { inputTokens: 0, outputTokens: 0 },
    }
  }

  const fingerprint = smartCrop.parseFingerprintArtifact(
    await readJsonArtifact(args.assetId, "smart-crop-fingerprint-v1"),
  )
  if (!fingerprint) {
    throw new SmartCropStepError(
      "fingerprint_invalid",
      `Fingerprint artifact for ${args.assetId} is missing or malformed`,
    )
  }

  const { launchSmartCropPlan } = await import("@/services/mastra-smart-crop")

  const batches = smartCrop.buildShotBatches(fingerprint.shots)
  const collectedSegments: import("@/services/mastra-smart-crop").SmartCropPlanSegment[][] =
    []
  const usages: SmartCropUsageTotals[] = []
  let model = args.model ?? "unknown"

  for (const batch of batches) {
    const result = await launchSmartCropPlan({
      asset: { assetId: args.assetId, playbackId: args.playbackId },
      source: fingerprint.source,
      target: { aspectRatio: "9:16", width: 1080, height: 1920 },
      cropMode: args.cropMode,
      shots: batch.map((shot) => ({
        shotId: shot.shotId,
        start: shot.start,
        end: shot.end,
        frameUrls: smartCrop.buildShotFrameUrls(args.playbackId, shot),
      })),
      ...(args.model ? { model: args.model } : {}),
    })

    if (!result.ok) {
      throw new SmartCropStepError(
        result.reason,
        `mastra smart-crop plan failed (${result.reason})${result.message ? `: ${result.message}` : ""}`,
      )
    }

    collectedSegments.push(result.segments)
    usages.push(result.usage)
    model = result.model
  }

  const usage = smartCrop.sumUsage(usages)
  const plan = smartCrop.assemblePlanArtifact({
    assetId: args.assetId,
    muxAssetId: args.muxAssetId,
    playbackId: args.playbackId,
    source: fingerprint.source,
    cropMode: args.cropMode,
    model,
    segmentsFromChunks: collectedSegments,
    usageTotals: usage,
  })

  await writeArtifact({
    assetId: args.assetId,
    artifactType: "smart-crop-plan-9x16-v1",
    ext: "json",
    body: JSON.stringify(plan, null, 2),
    contentType: "application/json",
  })

  return {
    skipped: false,
    segmentCount: plan.segments.length,
    approved: false,
    usage,
  }
}

async function stepSmartCropAlign(args: {
  jobId: string
  assetId: string
  canonicalAssetId: string
  language: string
  force: boolean
}): Promise<{
  skipped: boolean
  overallConfidence: number
  unmappedDurationPercent: number
  gatePassed: boolean
  gateFailures: string[]
}> {
  "use step"
  const { artifactExists, writeArtifact } = await import("@/services/storage")
  const smartCrop = await import("@/services/smartCrop")

  const exists = await artifactExists(
    args.assetId,
    "smart-crop-timeline-map-v1",
    "json",
  )
  if (smartCrop.shouldSkipWhenArtifactExists(exists, args.force)) {
    const summary = smartCrop.parseTimelineMapArtifactSummary(
      await readJsonArtifact(args.assetId, "smart-crop-timeline-map-v1"),
    )
    if (summary) {
      return { skipped: true, ...summary }
    }
    // Malformed existing artifact — fall through and recompute.
  }

  const planExists = await artifactExists(
    args.canonicalAssetId,
    "smart-crop-plan-9x16-v1",
    "json",
  )
  if (!planExists) {
    throw new SmartCropStepError(
      "canonical_plan_missing",
      `canonical_plan_missing: no smart-crop plan artifact for canonical asset ${args.canonicalAssetId}`,
    )
  }

  const plan = smartCrop.parsePlanArtifact(
    await readJsonArtifact(args.canonicalAssetId, "smart-crop-plan-9x16-v1"),
  )
  if (!plan) {
    throw new SmartCropStepError(
      "canonical_plan_invalid",
      `Canonical smart-crop plan artifact for ${args.canonicalAssetId} is malformed`,
    )
  }

  const canonicalFingerprintExists = await artifactExists(
    args.canonicalAssetId,
    "smart-crop-fingerprint-v1",
    "json",
  )
  if (!canonicalFingerprintExists) {
    throw new SmartCropStepError(
      "canonical_fingerprint_missing",
      `canonical_fingerprint_missing: no smart-crop fingerprint artifact for canonical asset ${args.canonicalAssetId}`,
    )
  }

  const canonicalFingerprint = await readJsonArtifact(
    args.canonicalAssetId,
    "smart-crop-fingerprint-v1",
  )
  const localizedFingerprint = await readJsonArtifact(
    args.assetId,
    "smart-crop-fingerprint-v1",
  )

  const { launchSmartCropAlign } = await import("@/services/mastra-smart-crop")
  const result = await launchSmartCropAlign({
    canonicalFingerprint,
    localizedFingerprint,
    language: args.language,
    planShotIds: plan.segments.map((segment) => segment.shotId),
  })

  if (!result.ok) {
    throw new SmartCropStepError(
      result.reason,
      `mastra smart-crop align failed (${result.reason})${result.message ? `: ${result.message}` : ""}`,
    )
  }

  const artifact = smartCrop.buildTimelineMapArtifact(
    result.timelineMap,
    {
      canonicalAssetId: args.canonicalAssetId,
      localizedAssetId: args.assetId,
    },
    args.language,
  )

  await writeArtifact({
    assetId: args.assetId,
    artifactType: "smart-crop-timeline-map-v1",
    ext: "json",
    body: JSON.stringify(artifact, null, 2),
    contentType: "application/json",
  })

  return {
    skipped: false,
    overallConfidence: result.timelineMap.overallConfidence,
    unmappedDurationPercent: result.timelineMap.unmappedDurationPercent,
    gatePassed: result.timelineMap.gate.passed,
    gateFailures: result.timelineMap.gate.failures,
  }
}

async function stepSmartCropPreviewRender(args: {
  jobId: string
  assetId: string
  playbackId: string
  kind: SmartCropKind
  cropPlanAssetId: string
  force: boolean
}): Promise<{ skipped: boolean; previewFrameKeys: string[] }> {
  "use step"
  const { artifactExists } = await import("@/services/storage")
  const smartCrop = await import("@/services/smartCrop")

  const exists = await artifactExists(
    args.assetId,
    "smart-crop-render-report-9x16-preview",
    "json",
  )
  if (smartCrop.shouldSkipWhenArtifactExists(exists, args.force)) {
    const report = await readJsonArtifact(
      args.assetId,
      "smart-crop-render-report-9x16-preview",
    )
    return {
      skipped: true,
      previewFrameKeys: smartCrop.listPreviewFrameLogicalKeys(report),
    }
  }

  const { runCropWorkerJob } = await import("@/services/crop-worker")
  const { getPlaybackUrl } = await import("@/services/mux")

  const result = await runCropWorkerJob({
    body: {
      kind: "render",
      jobId: args.jobId,
      assetId: args.assetId,
      source: { url: getPlaybackUrl(args.playbackId) },
      render: {
        mode: "preview",
        cropPlan: { assetId: args.cropPlanAssetId },
        ...(args.kind === "localized"
          ? { timelineMap: { assetId: args.assetId } }
          : {}),
        previewFrameCount: PREVIEW_FRAME_COUNT,
      },
    },
    pollTimeoutMs: PREVIEW_RENDER_POLL_TIMEOUT_MS,
  })

  if (!result.ok) {
    throw new SmartCropStepError(
      result.reason,
      `crop-worker preview render failed (${result.reason}): ${result.messages.join("; ")}`,
    )
  }

  const report = await readJsonArtifact(
    args.assetId,
    "smart-crop-render-report-9x16-preview",
  )
  return {
    skipped: false,
    previewFrameKeys: smartCrop.listPreviewFrameLogicalKeys(report),
  }
}

async function stepSmartCropQa(args: {
  jobId: string
  assetId: string
  cropPlanAssetId: string
  model?: string
  force: boolean
}): Promise<
  | { outcome: "presign_unavailable" }
  | {
      outcome: "exists" | "completed"
      verdict: SmartCropQaVerdict
      issueCount: number
      usage?: SmartCropUsageTotals
    }
> {
  "use step"
  const { artifactExists, writeArtifact, createPresignedArtifactUrl } =
    await import("@/services/storage")
  const smartCrop = await import("@/services/smartCrop")

  const exists = await artifactExists(
    args.assetId,
    "smart-crop-qa-9x16-v1",
    "json",
  )
  if (smartCrop.shouldSkipWhenArtifactExists(exists, args.force)) {
    const existing = (await readJsonArtifact(
      args.assetId,
      "smart-crop-qa-9x16-v1",
    )) as { verdict?: unknown; issues?: unknown }
    const verdict =
      existing.verdict === "pass" ||
      existing.verdict === "needs_repair" ||
      existing.verdict === "fail"
        ? existing.verdict
        : "needs_repair"
    return {
      outcome: "exists",
      verdict,
      issueCount: Array.isArray(existing.issues) ? existing.issues.length : 0,
    }
  }

  const renderReport = smartCrop.parseRenderReportSummary(
    await readJsonArtifact(
      args.assetId,
      "smart-crop-render-report-9x16-preview",
    ),
  )
  if (!renderReport || renderReport.previewFrameArtifactTypes.length === 0) {
    throw new SmartCropStepError(
      "preview_frames_missing",
      `Preview render report for ${args.assetId} reports no preview frames for QA`,
    )
  }

  const frameTimes = smartCrop.buildQaFrameTimes(
    renderReport.outputDurationSeconds,
    renderReport.previewFrameArtifactTypes.length,
  )

  const frames: Array<{ atSeconds: number; url: string }> = []
  for (const [
    index,
    frameType,
  ] of renderReport.previewFrameArtifactTypes.entries()) {
    const url = await createPresignedArtifactUrl(
      args.assetId,
      frameType,
      "jpg",
      QA_FRAME_PRESIGN_TTL_SECONDS,
    )
    if (url === null) {
      return { outcome: "presign_unavailable" }
    }
    frames.push({ atSeconds: frameTimes[index] ?? index, url })
  }

  const plan = smartCrop.parsePlanArtifact(
    await readJsonArtifact(args.cropPlanAssetId, "smart-crop-plan-9x16-v1"),
  )
  if (!plan) {
    throw new SmartCropStepError(
      "plan_missing",
      `Smart-crop plan artifact for ${args.cropPlanAssetId} is missing or malformed`,
    )
  }

  const { launchSmartCropQa } = await import("@/services/mastra-smart-crop")
  const result = await launchSmartCropQa({
    asset: { assetId: args.assetId },
    renderMode: "preview",
    planSummary: smartCrop.buildPlanSummary(plan),
    frames,
    ...(args.model ? { model: args.model } : {}),
  })

  if (!result.ok) {
    throw new SmartCropStepError(
      result.reason,
      `mastra smart-crop QA failed (${result.reason})${result.message ? `: ${result.message}` : ""}`,
    )
  }

  const artifact = smartCrop.buildQaArtifact({
    assetId: args.assetId,
    renderMode: "preview",
    verdict: result.verdict,
    issues: result.issues,
    frameCount: frames.length,
    model: result.model,
    usage: result.usage,
  })

  await writeArtifact({
    assetId: args.assetId,
    artifactType: "smart-crop-qa-9x16-v1",
    ext: "json",
    body: JSON.stringify(artifact, null, 2),
    contentType: "application/json",
  })

  return {
    outcome: "completed",
    verdict: result.verdict,
    issueCount: result.issues.length,
    usage: result.usage,
  }
}

async function stepSmartCropFullRender(args: {
  jobId: string
  assetId: string
  playbackId: string
  canonicalAssetId: string
  force: boolean
}): Promise<{ skipped: boolean }> {
  "use step"
  const { artifactExists } = await import("@/services/storage")
  const smartCrop = await import("@/services/smartCrop")

  const exists = await artifactExists(
    args.assetId,
    "smart-crop-render-report-9x16-full",
    "json",
  )
  if (smartCrop.shouldSkipWhenArtifactExists(exists, args.force)) {
    return { skipped: true }
  }

  const plan = smartCrop.parsePlanArtifact(
    await readJsonArtifact(args.canonicalAssetId, "smart-crop-plan-9x16-v1"),
  )
  if (!plan) {
    throw new SmartCropStepError(
      "canonical_plan_missing",
      `canonical_plan_missing: no smart-crop plan artifact for canonical asset ${args.canonicalAssetId}`,
    )
  }
  if (plan.qa.status !== "approved") {
    throw new SmartCropStepError(
      "canonical_plan_not_approved",
      `canonical_plan_not_approved: canonical plan for ${args.canonicalAssetId} has qa.status="${plan.qa.status}" — approve it before the full render`,
    )
  }

  const { runCropWorkerJob } = await import("@/services/crop-worker")
  const { getPlaybackUrl } = await import("@/services/mux")

  const result = await runCropWorkerJob({
    body: {
      kind: "render",
      jobId: args.jobId,
      assetId: args.assetId,
      source: { url: getPlaybackUrl(args.playbackId) },
      render: {
        mode: "full",
        cropPlan: { assetId: args.canonicalAssetId },
        timelineMap: { assetId: args.assetId },
      },
    },
    pollTimeoutMs: FULL_RENDER_POLL_TIMEOUT_MS,
  })

  if (!result.ok) {
    throw new SmartCropStepError(
      result.reason,
      `crop-worker full render failed (${result.reason}): ${result.messages.join("; ")}`,
    )
  }

  return { skipped: false }
}

async function stepSmartCropMuxOutput(args: {
  jobId: string
  assetId: string
}): Promise<
  | { outcome: "presign_unavailable" }
  | { outcome: "exists" | "created"; muxAssetId: string; playbackId?: string }
> {
  "use step"
  const { getJob } = await import("@/lib/state")
  const { getSmartCropReport } = await import("@/lib/smart-crop-report")

  // Idempotency: a previous run may already have created the output asset.
  const job = await getJob(args.jobId)
  const existingOutput = job ? getSmartCropReport(job.artifacts)?.output : null
  if (existingOutput?.muxAssetId) {
    return {
      outcome: "exists",
      muxAssetId: existingOutput.muxAssetId,
      playbackId: existingOutput.playbackId,
    }
  }

  const { createPresignedArtifactUrl } = await import("@/services/storage")
  const presignedUrl = await createPresignedArtifactUrl(
    args.assetId,
    "smart-crop-output-9x16",
    "mp4",
    OUTPUT_PRESIGN_TTL_SECONDS,
  )
  if (presignedUrl === null) {
    return { outcome: "presign_unavailable" }
  }

  const { createMuxAsset, getMuxAsset } = await import("@/services/mux")
  const created = await createMuxAsset({
    inputUrl: presignedUrl,
    passthrough: args.jobId,
  })

  console.log(
    `[smart-crop] event=mux_output_created jobId=${args.jobId} assetId=${args.assetId} muxAssetId=${created.assetId}`,
  )

  let snapshot = created
  let elapsedMs = 0
  while (snapshot.status !== "ready") {
    if (snapshot.status === "errored") {
      throw new SmartCropStepError(
        "mux_output_errored",
        `Mux output asset ${created.assetId} errored during preparation`,
      )
    }
    if (elapsedMs + MUX_OUTPUT_POLL_INTERVAL_MS > MUX_OUTPUT_POLL_TIMEOUT_MS) {
      throw new SmartCropStepError(
        "mux_output_timeout",
        `Mux output asset ${created.assetId} was not ready within ${MUX_OUTPUT_POLL_TIMEOUT_MS}ms`,
      )
    }
    await new Promise<void>((resolve) =>
      setTimeout(resolve, MUX_OUTPUT_POLL_INTERVAL_MS),
    )
    elapsedMs += MUX_OUTPUT_POLL_INTERVAL_MS
    snapshot = await getMuxAsset(created.assetId)
  }

  return {
    outcome: "created",
    muxAssetId: snapshot.assetId,
    playbackId: snapshot.playbackId || undefined,
  }
}

// Smart Crop pure-ish helpers (plan 2026-06-09-002): shot batching, frame URL
// construction, and artifact assembly. The durable workflow steps in
// src/workflows/smartCrop.ts compose these with storage/crop-worker/mastra
// service calls.

import { getThumbnailUrl } from "@/services/mux"
import type {
  SmartCropPlanSegment,
  SmartCropQaIssue,
  SmartCropTimelineMapPayload,
  SmartCropUsage,
} from "@/services/mastra-smart-crop"

export const SMART_CROP_PLAN_BATCH_SIZE = 8
export const SMART_CROP_FRAME_WIDTH = 768
export const SMART_CROP_PLANNER_VERSION = "smart-crop-planner-v1"

// ---------------------------------------------------------------------------
// Artifact shapes (wire contracts — literals from the plan doc)
// ---------------------------------------------------------------------------

export type SmartCropSourceInfo = {
  width: number
  height: number
  durationSeconds: number
}

export type SmartCropFingerprintShot = {
  shotId: string
  start: number
  end: number
  representativeHashes: Array<{ time: number; dhash: string }>
}

export type SmartCropFingerprintArtifact = {
  version: number
  kind: "smart-crop-fingerprint"
  assetId: string
  source: SmartCropSourceInfo
  sampling?: unknown
  shots: SmartCropFingerprintShot[]
  tool?: string
  generatedAt?: string
}

export type SmartCropPlanQa =
  | { status: "draft" }
  | { status: "approved" | "rejected"; approvedBy: string; approvedAt: string }

export type SmartCropPlanArtifact = {
  version: 1
  kind: "smart-crop-canonical-plan"
  assetId: string
  muxAssetId: string
  playbackId: string
  source: SmartCropSourceInfo
  target: { aspectRatio: "9:16"; width: number; height: number }
  strategy: {
    cropMode: string
    plannerVersion: typeof SMART_CROP_PLANNER_VERSION
    model: string
  }
  segments: SmartCropPlanSegment[]
  usage: SmartCropUsage
  qa: SmartCropPlanQa
  generatedAt: string
}

export type SmartCropTimelineMapArtifact = SmartCropTimelineMapPayload & {
  version: 1
  kind: "smart-crop-timeline-map"
  canonicalAssetId: string
  localizedAssetId: string
  language: string
  generatedAt: string
}

export type SmartCropQaArtifact = {
  version: 1
  kind: "smart-crop-qa-report"
  assetId: string
  renderMode: "preview" | "full"
  verdict: "pass" | "needs_repair" | "fail"
  issues: SmartCropQaIssue[]
  frameCount: number
  model: string
  usage: SmartCropUsage
  generatedAt: string
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

// Skip-when-exists idempotency decision shared by every smart-crop step.
export function shouldSkipWhenArtifactExists(
  exists: boolean,
  force: boolean | undefined,
): boolean {
  return exists && !force
}

export function buildShotBatches<T>(
  shots: readonly T[],
  batchSize: number = SMART_CROP_PLAN_BATCH_SIZE,
): T[][] {
  if (batchSize < 1) {
    throw new Error(`Invalid smart-crop batch size: ${batchSize}`)
  }

  const batches: T[][] = []
  for (let index = 0; index < shots.length; index += batchSize) {
    batches.push(shots.slice(index, index + batchSize))
  }
  return batches
}

// Up to 3 image.mux.com frame URLs per shot, sampled at 10%/50%/90% of the
// shot. Rounded times are deduped so very short shots yield fewer URLs;
// time 0 is preserved (getThumbnailUrl guards `time != null`, not falsy).
export function buildShotFrameUrls(
  playbackId: string,
  shot: { start: number; end: number },
): string[] {
  const duration = Math.max(0, shot.end - shot.start)
  const times = [0.1, 0.5, 0.9].map((progress) =>
    Math.round(shot.start + duration * progress),
  )

  return [...new Set(times)].map((time) =>
    getThumbnailUrl(playbackId, { width: SMART_CROP_FRAME_WIDTH, time }),
  )
}

export function sumUsage(usages: readonly SmartCropUsage[]): SmartCropUsage {
  return usages.reduce<SmartCropUsage>(
    (total, usage) => ({
      inputTokens: total.inputTokens + usage.inputTokens,
      outputTokens: total.outputTokens + usage.outputTokens,
    }),
    { inputTokens: 0, outputTokens: 0 },
  )
}

// Crop window MVP rule: width = largest even integer <= source.height * 9/16,
// height = source.height (horizontal-only panning). Target stays 1080x1920.
export function assemblePlanArtifact(input: {
  assetId: string
  muxAssetId: string
  playbackId: string
  source: SmartCropSourceInfo
  cropMode: string
  model: string
  segmentsFromChunks: readonly SmartCropPlanSegment[][]
  usageTotals: SmartCropUsage
  generatedAt?: string
}): SmartCropPlanArtifact {
  return {
    version: 1,
    kind: "smart-crop-canonical-plan",
    assetId: input.assetId,
    muxAssetId: input.muxAssetId,
    playbackId: input.playbackId,
    source: input.source,
    target: { aspectRatio: "9:16", width: 1080, height: 1920 },
    strategy: {
      cropMode: input.cropMode,
      plannerVersion: SMART_CROP_PLANNER_VERSION,
      model: input.model,
    },
    segments: input.segmentsFromChunks.flat(),
    usage: input.usageTotals,
    qa: { status: "draft" },
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  }
}

export function buildTimelineMapArtifact(
  timelineMap: SmartCropTimelineMapPayload,
  ids: { canonicalAssetId: string; localizedAssetId: string },
  language: string,
  generatedAt?: string,
): SmartCropTimelineMapArtifact {
  return {
    version: 1,
    kind: "smart-crop-timeline-map",
    canonicalAssetId: ids.canonicalAssetId,
    localizedAssetId: ids.localizedAssetId,
    language,
    mappingMethod: timelineMap.mappingMethod,
    overallConfidence: timelineMap.overallConfidence,
    unmappedDurationPercent: timelineMap.unmappedDurationPercent,
    maxConsecutiveUnmappedSeconds: timelineMap.maxConsecutiveUnmappedSeconds,
    segments: timelineMap.segments,
    gate: timelineMap.gate,
    warnings: timelineMap.warnings,
    generatedAt: generatedAt ?? new Date().toISOString(),
  }
}

export function buildQaArtifact(input: {
  assetId: string
  renderMode: "preview" | "full"
  verdict: "pass" | "needs_repair" | "fail"
  issues: SmartCropQaIssue[]
  frameCount: number
  model: string
  usage: SmartCropUsage
  generatedAt?: string
}): SmartCropQaArtifact {
  return {
    version: 1,
    kind: "smart-crop-qa-report",
    assetId: input.assetId,
    renderMode: input.renderMode,
    verdict: input.verdict,
    issues: input.issues,
    frameCount: input.frameCount,
    model: input.model,
    usage: input.usage,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  }
}

export function buildPlanSummary(plan: SmartCropPlanArtifact): {
  segmentCount: number
  modes: Record<string, number>
} {
  const modes: Record<string, number> = {}
  for (const segment of plan.segments) {
    modes[segment.mode] = (modes[segment.mode] ?? 0) + 1
  }
  return { segmentCount: plan.segments.length, modes }
}

// Approximate per-frame timestamps for QA: preview frames are sampled evenly
// across the rendered preview, so spread atSeconds proportionally.
export function buildQaFrameTimes(
  outputDurationSeconds: number | null,
  frameCount: number,
): number[] {
  if (frameCount <= 0) {
    return []
  }
  const duration =
    outputDurationSeconds != null && outputDurationSeconds > 0
      ? outputDurationSeconds
      : frameCount
  return Array.from({ length: frameCount }, (_, index) =>
    Math.round((duration * (index + 0.5)) / frameCount),
  )
}

// ---------------------------------------------------------------------------
// Duck-typed artifact readers (artifacts cross app boundaries as JSON)
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

export function parseFingerprintArtifact(
  value: unknown,
): SmartCropFingerprintArtifact | null {
  const record = asRecord(value)
  if (
    !record ||
    record.kind !== "smart-crop-fingerprint" ||
    typeof record.assetId !== "string" ||
    !Array.isArray(record.shots)
  ) {
    return null
  }

  const source = asRecord(record.source)
  if (
    !source ||
    typeof source.width !== "number" ||
    typeof source.height !== "number" ||
    typeof source.durationSeconds !== "number"
  ) {
    return null
  }

  const shots: SmartCropFingerprintShot[] = []
  for (const entry of record.shots) {
    const shot = asRecord(entry)
    if (
      !shot ||
      typeof shot.shotId !== "string" ||
      typeof shot.start !== "number" ||
      typeof shot.end !== "number"
    ) {
      return null
    }

    const representativeHashes: Array<{ time: number; dhash: string }> = []
    if (Array.isArray(shot.representativeHashes)) {
      for (const hashEntry of shot.representativeHashes) {
        const hash = asRecord(hashEntry)
        if (
          hash &&
          typeof hash.time === "number" &&
          typeof hash.dhash === "string"
        ) {
          representativeHashes.push({ time: hash.time, dhash: hash.dhash })
        }
      }
    }

    shots.push({
      shotId: shot.shotId,
      start: shot.start,
      end: shot.end,
      representativeHashes,
    })
  }

  return {
    version: typeof record.version === "number" ? record.version : 1,
    kind: "smart-crop-fingerprint",
    assetId: record.assetId,
    source: {
      width: source.width,
      height: source.height,
      durationSeconds: source.durationSeconds,
    },
    sampling: record.sampling,
    shots,
    tool: typeof record.tool === "string" ? record.tool : undefined,
    generatedAt:
      typeof record.generatedAt === "string" ? record.generatedAt : undefined,
  }
}

export function parsePlanArtifact(
  value: unknown,
): SmartCropPlanArtifact | null {
  const record = asRecord(value)
  if (
    !record ||
    record.kind !== "smart-crop-canonical-plan" ||
    typeof record.assetId !== "string" ||
    !Array.isArray(record.segments)
  ) {
    return null
  }

  const qa = asRecord(record.qa)
  if (
    !qa ||
    (qa.status !== "draft" &&
      qa.status !== "approved" &&
      qa.status !== "rejected")
  ) {
    return null
  }

  // The remaining fields are produced by manager itself (assemblePlanArtifact)
  // — pass them through with their wire types.
  return record as unknown as SmartCropPlanArtifact
}

export type SmartCropTimelineMapSummary = {
  overallConfidence: number
  unmappedDurationPercent: number
  gatePassed: boolean
  gateFailures: string[]
}

export function parseTimelineMapArtifactSummary(
  value: unknown,
): SmartCropTimelineMapSummary | null {
  const record = asRecord(value)
  if (
    !record ||
    record.kind !== "smart-crop-timeline-map" ||
    typeof record.overallConfidence !== "number" ||
    typeof record.unmappedDurationPercent !== "number"
  ) {
    return null
  }

  const gate = asRecord(record.gate)
  if (!gate || typeof gate.passed !== "boolean") {
    return null
  }

  return {
    overallConfidence: record.overallConfidence,
    unmappedDurationPercent: record.unmappedDurationPercent,
    gatePassed: gate.passed,
    gateFailures: Array.isArray(gate.failures)
      ? gate.failures.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
  }
}

export type SmartCropRenderReportSummary = {
  previewFrameArtifactTypes: string[]
  outputDurationSeconds: number | null
}

export function parseRenderReportSummary(
  value: unknown,
): SmartCropRenderReportSummary | null {
  const record = asRecord(value)
  if (!record || record.kind !== "smart-crop-render-report") {
    return null
  }

  const previewFrameArtifactTypes = Array.isArray(
    record.previewFrameArtifactTypes,
  )
    ? record.previewFrameArtifactTypes.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : []

  return {
    previewFrameArtifactTypes,
    outputDurationSeconds:
      typeof record.outputDurationSeconds === "number"
        ? record.outputDurationSeconds
        : null,
  }
}

// Preview-frame logical keys for the job artifact manifest. The crop-worker
// names frame artifact types `smart-crop-preview-frame-9x16-{NNN}`, which
// double as manager's logical keys (see lib/job-artifacts.ts).
export function listPreviewFrameLogicalKeys(renderReport: unknown): string[] {
  const summary = parseRenderReportSummary(renderReport)
  if (!summary) {
    return []
  }
  return summary.previewFrameArtifactTypes.filter((artifactType) =>
    /^smart-crop-preview-frame-9x16-\d{3}$/.test(artifactType),
  )
}

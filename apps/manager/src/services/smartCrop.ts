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
    plannerVersion: string
    model: string
  }
  segments: SmartCropPlanSegment[]
  usage: SmartCropUsage
  qa: SmartCropPlanQa
  generatedAt: string
}

// Provenance block stamped into the timeline map so the align step's
// skip-when-exists path can detect stale maps (canonical plan or fingerprint
// regenerated after the map was written). crop-worker reads the map with a
// loose schema, so the extra field is wire-safe. Values are the generatedAt
// timestamps of the inputs at map-build time (null when an input had none).
export type SmartCropTimelineMapProvenance = {
  canonicalPlanGeneratedAt: string | null
  canonicalFingerprintGeneratedAt: string | null
  localizedFingerprintGeneratedAt: string | null
}

export type SmartCropTimelineMapArtifact = SmartCropTimelineMapPayload & {
  version: 1
  kind: "smart-crop-timeline-map"
  canonicalAssetId: string
  localizedAssetId: string
  language: string
  provenance?: SmartCropTimelineMapProvenance
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
  provenance?: SmartCropTimelineMapProvenance,
): SmartCropTimelineMapArtifact {
  return {
    version: 1,
    kind: "smart-crop-timeline-map",
    canonicalAssetId: ids.canonicalAssetId,
    localizedAssetId: ids.localizedAssetId,
    language,
    ...(provenance ? { provenance } : {}),
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

const PLAN_SEGMENT_MODES = new Set<SmartCropPlanSegment["mode"]>([
  "speaker",
  "group",
  "object",
  "slide_aware",
  "action",
  "center_fallback",
])

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const strings = value.filter(
    (entry): entry is string => typeof entry === "string",
  )
  return strings.length === value.length ? strings : undefined
}

// Validates a plan-segment array (used by both the final plan artifact and
// the plan-progress checkpoint). Returns null when any entry is malformed.
export function parsePlanSegments(
  value: unknown,
): SmartCropPlanSegment[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const segments: SmartCropPlanSegment[] = []
  for (const entry of value) {
    const segment = asRecord(entry)
    if (
      !segment ||
      typeof segment.shotId !== "string" ||
      typeof segment.canonicalStart !== "number" ||
      typeof segment.canonicalEnd !== "number" ||
      typeof segment.mode !== "string" ||
      !PLAN_SEGMENT_MODES.has(segment.mode as SmartCropPlanSegment["mode"]) ||
      typeof segment.confidence !== "number" ||
      !Array.isArray(segment.cropKeyframes) ||
      segment.cropKeyframes.length === 0
    ) {
      return null
    }

    const cropKeyframes: SmartCropPlanSegment["cropKeyframes"] = []
    for (const keyframeEntry of segment.cropKeyframes) {
      const keyframe = asRecord(keyframeEntry)
      if (
        !keyframe ||
        typeof keyframe.progress !== "number" ||
        typeof keyframe.x !== "number" ||
        typeof keyframe.y !== "number" ||
        typeof keyframe.width !== "number" ||
        typeof keyframe.height !== "number"
      ) {
        return null
      }
      cropKeyframes.push({
        progress: keyframe.progress,
        x: keyframe.x,
        y: keyframe.y,
        width: keyframe.width,
        height: keyframe.height,
      })
    }

    segments.push({
      shotId: segment.shotId,
      canonicalStart: segment.canonicalStart,
      canonicalEnd: segment.canonicalEnd,
      mode: segment.mode as SmartCropPlanSegment["mode"],
      primarySubject:
        typeof segment.primarySubject === "string"
          ? segment.primarySubject
          : undefined,
      secondarySubjects: parseStringArray(segment.secondarySubjects),
      avoidCutting: parseStringArray(segment.avoidCutting),
      confidence: segment.confidence,
      cropKeyframes,
    })
  }

  return segments
}

function parseUsageRecord(value: unknown): SmartCropUsage | null {
  const usage = asRecord(value)
  if (
    !usage ||
    typeof usage.inputTokens !== "number" ||
    typeof usage.outputTokens !== "number"
  ) {
    return null
  }
  return { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
}

function parsePlanQa(value: unknown): SmartCropPlanQa | null {
  const qa = asRecord(value)
  if (!qa) {
    return null
  }
  if (qa.status === "draft") {
    return { status: "draft" }
  }
  if (
    (qa.status === "approved" || qa.status === "rejected") &&
    typeof qa.approvedBy === "string" &&
    typeof qa.approvedAt === "string"
  ) {
    return {
      status: qa.status,
      approvedBy: qa.approvedBy,
      approvedAt: qa.approvedAt,
    }
  }
  return null
}

function parseSourceInfo(value: unknown): SmartCropSourceInfo | null {
  const source = asRecord(value)
  if (
    !source ||
    typeof source.width !== "number" ||
    typeof source.height !== "number" ||
    typeof source.durationSeconds !== "number"
  ) {
    return null
  }
  return {
    width: source.width,
    height: source.height,
    durationSeconds: source.durationSeconds,
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
    typeof record.muxAssetId !== "string" ||
    typeof record.playbackId !== "string" ||
    typeof record.generatedAt !== "string"
  ) {
    return null
  }

  const source = parseSourceInfo(record.source)
  const target = asRecord(record.target)
  const strategy = asRecord(record.strategy)
  const segments = parsePlanSegments(record.segments)
  const usage = parseUsageRecord(record.usage)
  const qa = parsePlanQa(record.qa)
  if (
    !source ||
    !target ||
    target.aspectRatio !== "9:16" ||
    typeof target.width !== "number" ||
    typeof target.height !== "number" ||
    !strategy ||
    typeof strategy.cropMode !== "string" ||
    typeof strategy.plannerVersion !== "string" ||
    typeof strategy.model !== "string" ||
    !segments ||
    !usage ||
    !qa
  ) {
    return null
  }

  return {
    version: 1,
    kind: "smart-crop-canonical-plan",
    assetId: record.assetId,
    muxAssetId: record.muxAssetId,
    playbackId: record.playbackId,
    source,
    target: { aspectRatio: "9:16", width: target.width, height: target.height },
    strategy: {
      cropMode: strategy.cropMode,
      plannerVersion: strategy.plannerVersion,
      model: strategy.model,
    },
    segments,
    usage,
    qa,
    generatedAt: record.generatedAt,
  }
}

export type SmartCropTimelineMapSummary = {
  overallConfidence: number
  unmappedDurationPercent: number
  gatePassed: boolean
  gateFailures: string[]
  canonicalAssetId: string | null
  localizedAssetId: string | null
  // null for legacy maps written before provenance stamping — callers must
  // treat that as "unknown provenance" and recompute.
  provenance: SmartCropTimelineMapProvenance | null
}

function parseTimelineMapProvenance(
  value: unknown,
): SmartCropTimelineMapProvenance | null {
  const record = asRecord(value)
  if (!record) {
    return null
  }
  const read = (field: unknown): string | null =>
    typeof field === "string" ? field : null
  return {
    canonicalPlanGeneratedAt: read(record.canonicalPlanGeneratedAt),
    canonicalFingerprintGeneratedAt: read(
      record.canonicalFingerprintGeneratedAt,
    ),
    localizedFingerprintGeneratedAt: read(
      record.localizedFingerprintGeneratedAt,
    ),
  }
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
    canonicalAssetId:
      typeof record.canonicalAssetId === "string"
        ? record.canonicalAssetId
        : null,
    localizedAssetId:
      typeof record.localizedAssetId === "string"
        ? record.localizedAssetId
        : null,
    provenance: parseTimelineMapProvenance(record.provenance),
  }
}

// Decides whether an existing timeline map can be reused on the align step's
// skip-when-exists path. Reuse requires the map to name the SAME asset pair
// AND carry a provenance block matching the current canonical plan /
// fingerprint artifacts; legacy maps without provenance are recomputed.
export function timelineMapMatchesProvenance(
  summary: SmartCropTimelineMapSummary,
  expected: {
    canonicalAssetId: string
    localizedAssetId: string
    provenance: SmartCropTimelineMapProvenance
  },
): boolean {
  return (
    summary.canonicalAssetId === expected.canonicalAssetId &&
    summary.localizedAssetId === expected.localizedAssetId &&
    summary.provenance !== null &&
    summary.provenance.canonicalPlanGeneratedAt ===
      expected.provenance.canonicalPlanGeneratedAt &&
    summary.provenance.canonicalFingerprintGeneratedAt ===
      expected.provenance.canonicalFingerprintGeneratedAt &&
    summary.provenance.localizedFingerprintGeneratedAt ===
      expected.provenance.localizedFingerprintGeneratedAt
  )
}

// Canonical crop keyframes are pixel-space-specific: a plan computed against
// one resolution cannot be applied to a different-resolution localized
// master. Returns an operator-actionable message on mismatch, null when OK.
export function sourceDimensionsMismatch(
  canonical: SmartCropSourceInfo,
  localized: SmartCropSourceInfo,
): string | null {
  if (
    canonical.width === localized.width &&
    canonical.height === localized.height
  ) {
    return null
  }
  return `canonical ${canonical.width}x${canonical.height} != localized ${localized.width}x${localized.height}`
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

// ---------------------------------------------------------------------------
// Plan-progress checkpoint (manager-internal working artifact)
// ---------------------------------------------------------------------------

// Written after each successful mastra vision batch so a step retry / manager
// restart resumes from the first incomplete batch instead of re-paying every
// completed LLM call. Keyed to the fingerprint via fingerprintGeneratedAt —
// a regenerated fingerprint invalidates the checkpoint.
export const SMART_CROP_PLAN_PROGRESS_ARTIFACT_TYPE =
  "smart-crop-plan-progress-v1"

export type SmartCropPlanProgressArtifact = {
  version: 1
  kind: "smart-crop-plan-progress"
  fingerprintGeneratedAt: string | null
  batchSize: number
  totalBatches: number
  completedBatches: number
  segments: SmartCropPlanSegment[]
  usage: SmartCropUsage
  model?: string
}

export function buildPlanProgressArtifact(input: {
  fingerprintGeneratedAt: string | null
  batchSize: number
  totalBatches: number
  completedBatches: number
  segments: SmartCropPlanSegment[]
  usage: SmartCropUsage
  model?: string
}): SmartCropPlanProgressArtifact {
  return {
    version: 1,
    kind: "smart-crop-plan-progress",
    fingerprintGeneratedAt: input.fingerprintGeneratedAt,
    batchSize: input.batchSize,
    totalBatches: input.totalBatches,
    completedBatches: input.completedBatches,
    segments: input.segments,
    usage: input.usage,
    ...(input.model ? { model: input.model } : {}),
  }
}

// Returns a usable checkpoint only when it provably belongs to the CURRENT
// plan computation: same fingerprint provenance, same batching shape, and a
// sane completed count. Anything else means "start fresh".
export function parsePlanProgressArtifact(
  value: unknown,
  expected: {
    fingerprintGeneratedAt: string | null
    batchSize: number
    totalBatches: number
  },
): SmartCropPlanProgressArtifact | null {
  const record = asRecord(value)
  if (
    !record ||
    record.kind !== "smart-crop-plan-progress" ||
    typeof record.batchSize !== "number" ||
    typeof record.totalBatches !== "number" ||
    typeof record.completedBatches !== "number"
  ) {
    return null
  }

  const fingerprintGeneratedAt =
    typeof record.fingerprintGeneratedAt === "string"
      ? record.fingerprintGeneratedAt
      : null
  if (
    fingerprintGeneratedAt !== expected.fingerprintGeneratedAt ||
    record.batchSize !== expected.batchSize ||
    record.totalBatches !== expected.totalBatches ||
    record.completedBatches < 1 ||
    record.completedBatches > record.totalBatches ||
    !Number.isInteger(record.completedBatches)
  ) {
    return null
  }

  const segments = parsePlanSegments(record.segments)
  const usage = parseUsageRecord(record.usage)
  if (!segments || !usage) {
    return null
  }

  return {
    version: 1,
    kind: "smart-crop-plan-progress",
    fingerprintGeneratedAt,
    batchSize: record.batchSize,
    totalBatches: record.totalBatches,
    completedBatches: record.completedBatches,
    segments,
    usage,
    model: typeof record.model === "string" ? record.model : undefined,
  }
}

// ---------------------------------------------------------------------------
// Mux output record (idempotency artifact for the Mux output step)
// ---------------------------------------------------------------------------

// Written IMMEDIATELY after createMuxAsset returns (before readiness polling)
// so a step retry / operator retry resumes polling the recorded asset instead
// of creating a duplicate billable Mux asset. playbackId + ready are only
// recorded once the asset reached "ready".
export const SMART_CROP_MUX_OUTPUT_ARTIFACT_TYPE = "smart-crop-mux-output-v1"

export type SmartCropMuxOutputRecord = {
  version: 1
  kind: "smart-crop-mux-output"
  jobId: string
  muxAssetId: string
  ready: boolean
  playbackId?: string
  createdAt: string
}

export function buildMuxOutputRecord(input: {
  jobId: string
  muxAssetId: string
  ready: boolean
  playbackId?: string
  createdAt?: string
}): SmartCropMuxOutputRecord {
  return {
    version: 1,
    kind: "smart-crop-mux-output",
    jobId: input.jobId,
    muxAssetId: input.muxAssetId,
    ready: input.ready,
    ...(input.playbackId ? { playbackId: input.playbackId } : {}),
    createdAt: input.createdAt ?? new Date().toISOString(),
  }
}

export function parseMuxOutputRecord(
  value: unknown,
): SmartCropMuxOutputRecord | null {
  const record = asRecord(value)
  if (
    !record ||
    record.kind !== "smart-crop-mux-output" ||
    typeof record.jobId !== "string" ||
    typeof record.muxAssetId !== "string" ||
    typeof record.ready !== "boolean"
  ) {
    return null
  }

  return {
    version: 1,
    kind: "smart-crop-mux-output",
    jobId: record.jobId,
    muxAssetId: record.muxAssetId,
    ready: record.ready,
    playbackId:
      typeof record.playbackId === "string" ? record.playbackId : undefined,
    createdAt:
      typeof record.createdAt === "string"
        ? record.createdAt
        : new Date(0).toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Render progress throttle
// ---------------------------------------------------------------------------

export type SmartCropProgressSnapshot = {
  progress: number | null
  message: string | null
}

export const SMART_CROP_PROGRESS_MIN_DELTA = 0.05

// Keeps step-detail write volume low while a crop-worker render polls for
// hours: emit only when progress advanced by at least minDelta or the
// human-readable message changed.
export function shouldEmitRenderProgress(
  last: SmartCropProgressSnapshot | null,
  next: SmartCropProgressSnapshot,
  minDelta: number = SMART_CROP_PROGRESS_MIN_DELTA,
): boolean {
  if (next.progress === null && next.message === null) {
    return false
  }
  if (last === null) {
    return true
  }
  if (next.message !== null && next.message !== last.message) {
    return true
  }
  if (
    next.progress !== null &&
    (last.progress === null || next.progress - last.progress >= minDelta)
  ) {
    return true
  }
  return false
}

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
export const SMART_CROP_MAX_REPAIR_ATTEMPTS = 2
export const SMART_CROP_ATTEMPTS_ARTIFACT_TYPE = "smart-crop-attempts-9x16-v1"

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

export type SmartCropAttemptStatus =
  | "planned"
  | "previewed"
  | "qa_unavailable"
  | "complete"
  | "failed"
  | "approved"
  | "rejected"

export type SmartCropAttemptArtifactKeys = {
  attemptIndex: number
  suffix: string | null
  planLogicalKey: string
  planArtifactType: string
  previewLogicalKey: string
  previewArtifactType: string
  renderReportLogicalKey: string
  renderReportArtifactType: string
  qaLogicalKey: string
  qaArtifactType: string
  previewFrameLogicalKeyPattern: string
}

export type SmartCropAttemptSummary = SmartCropAttemptArtifactKeys & {
  status: SmartCropAttemptStatus
  source: "initial" | "repair"
  repairedFromAttemptIndex?: number
  createdAt: string
  updatedAt: string
  previewFrameLogicalKeys: string[]
  qa?: {
    verdict?: SmartCropQaArtifact["verdict"]
    unavailableReason?: string
    issueCount: number
    repairTriggerCount: number
  }
  triggerIssues: SmartCropQaIssue[]
}

export type SmartCropAttemptsArtifact = {
  version: 1
  kind: "smart-crop-attempts"
  assetId: string
  maxRepairAttempts: number
  selectedAttemptIndex?: number
  attempts: SmartCropAttemptSummary[]
  updatedAt: string
  manifestDigest: string
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

export function formatSmartCropAttemptSuffix(attemptIndex: number): string {
  if (!Number.isInteger(attemptIndex) || attemptIndex < 0) {
    throw new Error(`Invalid smart-crop attempt index: ${attemptIndex}`)
  }
  return `attempt-${String(attemptIndex).padStart(3, "0")}`
}

export function buildSmartCropAttemptArtifactKeys(
  attemptIndex: number,
): SmartCropAttemptArtifactKeys {
  const suffix = formatSmartCropAttemptSuffix(attemptIndex)

  return {
    attemptIndex,
    suffix,
    planLogicalKey: `smart-crop-plan-${suffix}`,
    planArtifactType: `smart-crop-plan-9x16-${suffix}-v1`,
    previewLogicalKey: `smart-crop-preview-${suffix}`,
    previewArtifactType: `smart-crop-preview-9x16-${suffix}`,
    renderReportLogicalKey: `smart-crop-render-report-preview-${suffix}`,
    renderReportArtifactType: `smart-crop-render-report-9x16-preview-${suffix}`,
    qaLogicalKey: `smart-crop-qa-${suffix}`,
    qaArtifactType: `smart-crop-qa-9x16-${suffix}-v1`,
    previewFrameLogicalKeyPattern: `smart-crop-preview-frame-9x16-{NNN}-${suffix}`,
  }
}

export function buildSmartCropAttemptSummary(input: {
  attemptIndex: number
  status: SmartCropAttemptStatus
  source: "initial" | "repair"
  repairedFromAttemptIndex?: number
  createdAt?: string
  updatedAt?: string
  previewFrameLogicalKeys?: string[]
  qa?: SmartCropAttemptSummary["qa"]
  triggerIssues?: SmartCropQaIssue[]
}): SmartCropAttemptSummary {
  const now = new Date().toISOString()
  return {
    ...buildSmartCropAttemptArtifactKeys(input.attemptIndex),
    status: input.status,
    source: input.source,
    ...(input.repairedFromAttemptIndex != null
      ? { repairedFromAttemptIndex: input.repairedFromAttemptIndex }
      : {}),
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    previewFrameLogicalKeys: input.previewFrameLogicalKeys ?? [],
    ...(input.qa ? { qa: input.qa } : {}),
    triggerIssues: input.triggerIssues ?? [],
  }
}

function normalizeForDigest(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(normalizeForDigest).join(",")}]`
  }
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .filter((key) => key !== "manifestDigest")
    .sort()
    .map((key) => `${JSON.stringify(key)}:${normalizeForDigest(record[key])}`)
    .join(",")}}`
}

export function digestSmartCropAttemptsArtifact(
  artifact: Omit<SmartCropAttemptsArtifact, "manifestDigest"> & {
    manifestDigest?: string
  },
): string {
  const normalized = normalizeForDigest(artifact)
  let hash = 0x811c9dc5
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`
}

export function buildSmartCropAttemptsArtifact(input: {
  assetId: string
  attempts: SmartCropAttemptSummary[]
  selectedAttemptIndex?: number
  maxRepairAttempts?: number
  updatedAt?: string
}): SmartCropAttemptsArtifact {
  const artifact = {
    version: 1 as const,
    kind: "smart-crop-attempts" as const,
    assetId: input.assetId,
    maxRepairAttempts:
      input.maxRepairAttempts ?? SMART_CROP_MAX_REPAIR_ATTEMPTS,
    ...(input.selectedAttemptIndex != null
      ? { selectedAttemptIndex: input.selectedAttemptIndex }
      : {}),
    attempts: [...input.attempts].sort(
      (left, right) => left.attemptIndex - right.attemptIndex,
    ),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  }
  const serializable = JSON.parse(JSON.stringify(artifact)) as Omit<
    SmartCropAttemptsArtifact,
    "manifestDigest"
  >
  return {
    ...serializable,
    manifestDigest: digestSmartCropAttemptsArtifact(serializable),
  }
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

function parseNormalizedPoint(
  value: unknown,
): { cx: number; cy: number } | null {
  const point = asRecord(value)
  if (!point || typeof point.cx !== "number" || typeof point.cy !== "number") {
    return null
  }
  return { cx: point.cx, cy: point.cy }
}

function parseFaceCenter(
  value: unknown,
): SmartCropPlanSegment["faceCenter"] | null {
  const center = asRecord(value)
  if (!center) {
    return null
  }
  const start = parseNormalizedPoint(center.start)
  const end = parseNormalizedPoint(center.end)
  if (!start || !end) {
    return null
  }
  return { start, end }
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

    if (
      segment.faceVisible !== undefined &&
      typeof segment.faceVisible !== "boolean"
    ) {
      return null
    }
    let faceCenter: SmartCropPlanSegment["faceCenter"] | undefined
    if (segment.faceCenter === null) {
      faceCenter = null
    } else if (segment.faceCenter !== undefined) {
      faceCenter = parseFaceCenter(segment.faceCenter) ?? undefined
      if (!faceCenter) {
        return null
      }
    }

    const parsed: SmartCropPlanSegment = {
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
    }
    if (typeof segment.faceVisible === "boolean") {
      parsed.faceVisible = segment.faceVisible
    }
    if (segment.faceCenter !== undefined) {
      parsed.faceCenter = faceCenter
    }
    segments.push(parsed)
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

function parseQaIssue(value: unknown): SmartCropQaIssue | null {
  const issue = asRecord(value)
  if (
    !issue ||
    (issue.severity !== "info" &&
      issue.severity !== "warning" &&
      issue.severity !== "critical") ||
    typeof issue.description !== "string"
  ) {
    return null
  }
  return {
    severity: issue.severity,
    description: issue.description,
    atSeconds:
      typeof issue.atSeconds === "number" ? issue.atSeconds : undefined,
    shotId: typeof issue.shotId === "string" ? issue.shotId : undefined,
  }
}

function parseAttemptQaSummary(
  value: unknown,
): SmartCropAttemptSummary["qa"] | undefined {
  const qa = asRecord(value)
  if (!qa || typeof qa.issueCount !== "number") {
    return undefined
  }
  const verdict =
    qa.verdict === "pass" ||
    qa.verdict === "needs_repair" ||
    qa.verdict === "fail"
      ? qa.verdict
      : undefined
  return {
    ...(verdict ? { verdict } : {}),
    unavailableReason:
      typeof qa.unavailableReason === "string"
        ? qa.unavailableReason
        : undefined,
    issueCount: qa.issueCount,
    repairTriggerCount:
      typeof qa.repairTriggerCount === "number" ? qa.repairTriggerCount : 0,
  }
}

const ATTEMPT_STATUSES = new Set<SmartCropAttemptStatus>([
  "planned",
  "previewed",
  "qa_unavailable",
  "complete",
  "failed",
  "approved",
  "rejected",
])

export function parseSmartCropAttemptsArtifact(
  value: unknown,
): SmartCropAttemptsArtifact | null {
  const record = asRecord(value)
  if (
    !record ||
    record.kind !== "smart-crop-attempts" ||
    typeof record.assetId !== "string" ||
    typeof record.maxRepairAttempts !== "number" ||
    !Array.isArray(record.attempts) ||
    typeof record.updatedAt !== "string" ||
    typeof record.manifestDigest !== "string"
  ) {
    return null
  }
  if (
    digestSmartCropAttemptsArtifact(
      record as Omit<SmartCropAttemptsArtifact, "manifestDigest"> & {
        manifestDigest?: string
      },
    ) !== record.manifestDigest
  ) {
    return null
  }

  const attempts: SmartCropAttemptSummary[] = []
  for (const entry of record.attempts) {
    const attempt = asRecord(entry)
    if (
      !attempt ||
      typeof attempt.attemptIndex !== "number" ||
      typeof attempt.status !== "string" ||
      !ATTEMPT_STATUSES.has(attempt.status as SmartCropAttemptStatus) ||
      (attempt.source !== "initial" && attempt.source !== "repair") ||
      typeof attempt.planLogicalKey !== "string" ||
      typeof attempt.planArtifactType !== "string" ||
      typeof attempt.previewLogicalKey !== "string" ||
      typeof attempt.previewArtifactType !== "string" ||
      typeof attempt.renderReportLogicalKey !== "string" ||
      typeof attempt.renderReportArtifactType !== "string" ||
      typeof attempt.qaLogicalKey !== "string" ||
      typeof attempt.qaArtifactType !== "string" ||
      typeof attempt.previewFrameLogicalKeyPattern !== "string" ||
      typeof attempt.createdAt !== "string" ||
      typeof attempt.updatedAt !== "string"
    ) {
      return null
    }

    const previewFrameLogicalKeys = Array.isArray(
      attempt.previewFrameLogicalKeys,
    )
      ? attempt.previewFrameLogicalKeys.filter(
          (key): key is string => typeof key === "string",
        )
      : []
    const triggerIssues = Array.isArray(attempt.triggerIssues)
      ? attempt.triggerIssues.map(parseQaIssue).filter((issue) => issue != null)
      : []

    attempts.push({
      attemptIndex: attempt.attemptIndex,
      suffix: typeof attempt.suffix === "string" ? attempt.suffix : null,
      planLogicalKey: attempt.planLogicalKey,
      planArtifactType: attempt.planArtifactType,
      previewLogicalKey: attempt.previewLogicalKey,
      previewArtifactType: attempt.previewArtifactType,
      renderReportLogicalKey: attempt.renderReportLogicalKey,
      renderReportArtifactType: attempt.renderReportArtifactType,
      qaLogicalKey: attempt.qaLogicalKey,
      qaArtifactType: attempt.qaArtifactType,
      previewFrameLogicalKeyPattern: attempt.previewFrameLogicalKeyPattern,
      status: attempt.status as SmartCropAttemptStatus,
      source: attempt.source,
      repairedFromAttemptIndex:
        typeof attempt.repairedFromAttemptIndex === "number"
          ? attempt.repairedFromAttemptIndex
          : undefined,
      createdAt: attempt.createdAt,
      updatedAt: attempt.updatedAt,
      previewFrameLogicalKeys,
      qa: parseAttemptQaSummary(attempt.qa),
      triggerIssues,
    })
  }

  const artifact: SmartCropAttemptsArtifact = {
    version: 1,
    kind: "smart-crop-attempts",
    assetId: record.assetId,
    maxRepairAttempts: record.maxRepairAttempts,
    selectedAttemptIndex:
      typeof record.selectedAttemptIndex === "number"
        ? record.selectedAttemptIndex
        : undefined,
    attempts,
    updatedAt: record.updatedAt,
    manifestDigest: record.manifestDigest,
  }

  return artifact
}

const CROP_AFFECTING_WARNING_PATTERN =
  /\b(crop|framing|face|head|subject|speaker|cut off|cut-off|off[- ]?center|out of frame|edge|composition|shot|pan|drift|keyframe|safe zone)\b/i

export function isSmartCropQaIssueRepairTrigger(
  issue: SmartCropQaIssue,
): boolean {
  if (issue.severity === "critical") {
    return true
  }
  if (issue.severity !== "warning") {
    return false
  }
  return Boolean(
    issue.shotId || CROP_AFFECTING_WARNING_PATTERN.test(issue.description),
  )
}

export type SmartCropQaRepairDecision = {
  action: "repair" | "accept" | "fail"
  reason:
    | "clean_pass"
    | "report_only_issues"
    | "verdict_needs_repair"
    | "verdict_fail"
    | "repair_triggering_issue"
    | "max_repairs_reached"
    | "critical_after_max_repairs"
  triggerIssues: SmartCropQaIssue[]
}

export function shouldRepairSmartCropQa(input: {
  verdict: SmartCropQaArtifact["verdict"]
  issues: readonly SmartCropQaIssue[]
  repairAttemptCount: number
  maxRepairAttempts?: number
}): SmartCropQaRepairDecision {
  const triggerIssues = input.issues.filter(isSmartCropQaIssueRepairTrigger)
  const maxRepairAttempts =
    input.maxRepairAttempts ?? SMART_CROP_MAX_REPAIR_ATTEMPTS
  const hasRepairSignal =
    input.verdict === "needs_repair" ||
    input.verdict === "fail" ||
    triggerIssues.length > 0

  if (!hasRepairSignal) {
    return {
      action: "accept",
      reason: input.issues.length === 0 ? "clean_pass" : "report_only_issues",
      triggerIssues,
    }
  }

  if (input.repairAttemptCount < maxRepairAttempts) {
    return {
      action: "repair",
      reason:
        input.verdict === "fail"
          ? "verdict_fail"
          : input.verdict === "needs_repair"
            ? "verdict_needs_repair"
            : "repair_triggering_issue",
      triggerIssues,
    }
  }

  const hasCritical = input.issues.some(
    (issue) => issue.severity === "critical",
  )
  return {
    action: input.verdict === "fail" || hasCritical ? "fail" : "accept",
    reason:
      input.verdict === "fail" || hasCritical
        ? "critical_after_max_repairs"
        : "max_repairs_reached",
    triggerIssues,
  }
}

export function mergeSmartCropRepairSegments(input: {
  previousPlan: SmartCropPlanArtifact
  replacementSegments: SmartCropPlanSegment[]
  expectedShotIds: string[]
  model: string
  usage: SmartCropUsage
  generatedAt?: string
}): SmartCropPlanArtifact {
  const expected = new Set(input.expectedShotIds)
  const replacements = new Map(
    input.replacementSegments.map((segment) => [segment.shotId, segment]),
  )
  if (
    input.replacementSegments.length !== expected.size ||
    replacements.size !== expected.size ||
    [...expected].some((shotId) => !replacements.has(shotId))
  ) {
    throw new Error(
      `repair_segments_mismatch: expected ${[...expected].join(", ")} but got ${input.replacementSegments.map((segment) => segment.shotId).join(", ")}`,
    )
  }

  const mergedSegments = input.previousPlan.segments.map(
    (segment) => replacements.get(segment.shotId) ?? segment,
  )
  return {
    ...input.previousPlan,
    strategy: { ...input.previousPlan.strategy, model: input.model },
    segments: mergedSegments,
    usage: sumUsage([input.previousPlan.usage, input.usage]),
    qa: { status: "draft" },
    generatedAt: input.generatedAt ?? new Date().toISOString(),
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
  renderedSegments: Array<{
    shotId: string
    outputStartSeconds: number
    outputEndSeconds: number
  }>
  renderedShotIds: string[]
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
  const renderedSegments = Array.isArray(record.renderedSegments)
    ? record.renderedSegments
        .map((entry) => asRecord(entry))
        .filter(
          (entry): entry is Record<string, unknown> =>
            entry !== null &&
            typeof entry.shotId === "string" &&
            typeof entry.outputStartSeconds === "number" &&
            typeof entry.outputEndSeconds === "number",
        )
        .map((entry) => ({
          shotId: entry.shotId as string,
          outputStartSeconds: entry.outputStartSeconds as number,
          outputEndSeconds: entry.outputEndSeconds as number,
        }))
    : []

  return {
    previewFrameArtifactTypes,
    outputDurationSeconds:
      typeof record.outputDurationSeconds === "number"
        ? record.outputDurationSeconds
        : null,
    renderedSegments,
    renderedShotIds: [
      ...new Set(renderedSegments.map((entry) => entry.shotId)),
    ],
  }
}

export function findRenderedShotIdAtTime(
  summary: SmartCropRenderReportSummary,
  atSeconds: number,
): string | undefined {
  return summary.renderedSegments.find((segment, index) => {
    const isLast = index === summary.renderedSegments.length - 1
    return (
      atSeconds >= segment.outputStartSeconds &&
      (atSeconds < segment.outputEndSeconds ||
        (isLast && atSeconds <= segment.outputEndSeconds))
    )
  })?.shotId
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
    /^smart-crop-preview-frame-9x16-\d{3}(?:-attempt-\d{3})?$/.test(
      artifactType,
    ),
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

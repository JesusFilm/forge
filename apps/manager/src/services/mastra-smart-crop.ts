// Manager → Mastra smart-crop launchers (plan 2026-06-09-002 "Mastra service
// routes"). Mirrors src/services/mastra-transcript-embeddings.ts: POST to the
// Mastra service route, bearer MASTRA_SERVICE_API_KEY, response envelope
// `{ result: <discriminated union> }`, duck-typed parsing against the EXACT
// producer literals from the plan doc.
//
// Routes:
//   POST /forge-smart-crop-plan   — vision LLM crop intent → plan segments
//   POST /forge-smart-crop-align  — shot alignment + confidence gates
//   POST /forge-smart-crop-qa     — vision LLM preview review

import { env } from "@/config/env"

const DEFAULT_TIMEOUT_MS = 120_000

// Mastra-produced failure reasons (wire contract) + client-side transport
// reasons (config_missing / auth_failed / network_error / parse_error).
const FAILURE_REASON_VALUES = [
  "config_missing",
  "auth_failed",
  "network_error",
  "parse_error",
  "invalid_input",
  "provider_config_missing",
  "provider_auth_failed",
  "provider_rate_limited",
  "provider_failed",
  "provider_invalid_output",
  "frame_host_not_allowed",
] as const

const FAILURE_REASONS = new Set<string>(FAILURE_REASON_VALUES)

export type MastraSmartCropFailureReason =
  (typeof FAILURE_REASON_VALUES)[number]

export type MastraSmartCropFailure = {
  ok: false
  reason: MastraSmartCropFailureReason
  retryable: boolean
  message?: string
  mastraRunId?: string
}

export type SmartCropUsage = {
  inputTokens: number
  outputTokens: number
}

export type SmartCropPlanSegmentMode =
  | "speaker"
  | "group"
  | "object"
  | "slide_aware"
  | "action"
  | "center_fallback"

export type SmartCropCropKeyframe = {
  progress: number
  x: number
  y: number
  width: number
  height: number
}

export type SmartCropNormalizedPoint = {
  cx: number
  cy: number
}

export type SmartCropFaceCenter = {
  start: SmartCropNormalizedPoint
  end: SmartCropNormalizedPoint
}

export type SmartCropPlanSegment = {
  shotId: string
  canonicalStart: number
  canonicalEnd: number
  mode: SmartCropPlanSegmentMode
  primarySubject?: string
  secondarySubjects?: string[]
  avoidCutting?: string[]
  confidence: number
  faceVisible?: boolean
  faceCenter?: SmartCropFaceCenter | null
  cropKeyframes: SmartCropCropKeyframe[]
}

export type SmartCropPlanLaunchResult =
  | {
      ok: true
      segments: SmartCropPlanSegment[]
      usage: SmartCropUsage
      model: string
    }
  | MastraSmartCropFailure

export type SmartCropTimelineMapSegment = {
  canonicalShotId: string
  canonicalStart: number
  canonicalEnd: number
  localizedStart: number
  localizedEnd: number
  confidence: number
}

export type SmartCropAlignGate = {
  passed: boolean
  failures: string[]
  config: Record<string, number>
}

export type SmartCropTimelineMapPayload = {
  mappingMethod: "identical-duration" | "shot-sequence"
  overallConfidence: number
  unmappedDurationPercent: number
  maxConsecutiveUnmappedSeconds: number
  segments: SmartCropTimelineMapSegment[]
  gate: SmartCropAlignGate
  warnings: string[]
}

export type SmartCropAlignLaunchResult =
  | {
      ok: true
      timelineMap: SmartCropTimelineMapPayload
    }
  | MastraSmartCropFailure

export type SmartCropQaIssue = {
  severity: "info" | "warning" | "critical"
  description: string
  atSeconds?: number
  shotId?: string
}

export type SmartCropQaLaunchResult =
  | {
      ok: true
      verdict: "pass" | "needs_repair" | "fail"
      issues: SmartCropQaIssue[]
      usage: SmartCropUsage
      model: string
    }
  | MastraSmartCropFailure

export type SmartCropPlanLaunchInput = {
  asset: { assetId: string; playbackId: string }
  source: { width: number; height: number; durationSeconds: number }
  target: { aspectRatio: "9:16"; width: number; height: number }
  cropMode: string
  shots: Array<{
    shotId: string
    start: number
    end: number
    frameUrls: string[]
  }>
  model?: string
}

export type SmartCropAlignLaunchInput = {
  canonicalFingerprint: unknown
  localizedFingerprint: unknown
  language: string
  planShotIds: string[]
  gates?: Record<string, number>
}

export type SmartCropQaLaunchInput = {
  asset: { assetId: string }
  renderMode: "preview" | "full"
  planSummary: { segmentCount: number; modes: Record<string, number> }
  frames: Array<{ atSeconds: number; url: string; shotId?: string }>
  model?: string
}

export type SmartCropRepairLaunchInput = {
  asset: { assetId: string; playbackId?: string }
  source: { width: number; height: number; durationSeconds: number }
  target: { aspectRatio: "9:16"; width: number; height: number }
  attempt: {
    index: number
    previousPlanGeneratedAt: string
  }
  issues: SmartCropQaIssue[]
  shots: Array<{
    shotId: string
    start: number
    end: number
    previousSegment: SmartCropPlanSegment
    frameUrls: string[]
  }>
  model?: string
}

export type SmartCropRepairLaunchResult =
  | {
      ok: true
      segments: SmartCropPlanSegment[]
      usage: SmartCropUsage
      model: string
    }
  | MastraSmartCropFailure

export type LaunchMastraSmartCropOptions = {
  baseUrl?: string
  bearer?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function parseFailure(
  result: Record<string, unknown>,
): MastraSmartCropFailure | null {
  if (
    typeof result.reason !== "string" ||
    !FAILURE_REASONS.has(result.reason) ||
    typeof result.retryable !== "boolean"
  ) {
    return null
  }

  return {
    ok: false,
    reason: result.reason as MastraSmartCropFailureReason,
    retryable:
      result.reason === "provider_rate_limited" ? false : result.retryable,
    message: typeof result.message === "string" ? result.message : undefined,
    mastraRunId:
      typeof result.mastraRunId === "string" ? result.mastraRunId : undefined,
  }
}

function parseUsage(value: unknown): SmartCropUsage | null {
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

const PLAN_SEGMENT_MODES = new Set([
  "speaker",
  "group",
  "object",
  "slide_aware",
  "action",
  "center_fallback",
])

function parseOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const strings = value.filter(
    (entry): entry is string => typeof entry === "string",
  )
  return strings.length === value.length ? strings : undefined
}

function parseNormalizedPoint(value: unknown): SmartCropNormalizedPoint | null {
  const point = asRecord(value)
  if (!point || typeof point.cx !== "number" || typeof point.cy !== "number") {
    return null
  }
  return { cx: point.cx, cy: point.cy }
}

function parseFaceCenter(value: unknown): SmartCropFaceCenter | null {
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

function parsePlanSegment(value: unknown): SmartCropPlanSegment | null {
  const segment = asRecord(value)
  if (
    !segment ||
    typeof segment.shotId !== "string" ||
    typeof segment.canonicalStart !== "number" ||
    typeof segment.canonicalEnd !== "number" ||
    typeof segment.mode !== "string" ||
    !PLAN_SEGMENT_MODES.has(segment.mode) ||
    typeof segment.confidence !== "number" ||
    !Array.isArray(segment.cropKeyframes)
  ) {
    return null
  }

  const cropKeyframes: SmartCropCropKeyframe[] = []
  for (const entry of segment.cropKeyframes) {
    const keyframe = asRecord(entry)
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
  let faceCenter: SmartCropFaceCenter | null | undefined
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
    mode: segment.mode as SmartCropPlanSegmentMode,
    primarySubject:
      typeof segment.primarySubject === "string"
        ? segment.primarySubject
        : undefined,
    secondarySubjects: parseOptionalStringArray(segment.secondarySubjects),
    avoidCutting: parseOptionalStringArray(segment.avoidCutting),
    confidence: segment.confidence,
    cropKeyframes,
  }
  if (typeof segment.faceVisible === "boolean") {
    parsed.faceVisible = segment.faceVisible
  }
  if (segment.faceCenter !== undefined) {
    parsed.faceCenter = faceCenter
  }
  return parsed
}

function parsePlanResult(value: unknown): SmartCropPlanLaunchResult | null {
  const record = asRecord(value)
  const result = asRecord(record?.result)
  if (!result || typeof result.ok !== "boolean") return null

  if (result.ok === false) {
    return parseFailure(result)
  }

  if (!Array.isArray(result.segments) || typeof result.model !== "string") {
    return null
  }
  const usage = parseUsage(result.usage)
  if (!usage) {
    return null
  }

  const segments: SmartCropPlanSegment[] = []
  for (const entry of result.segments) {
    const segment = parsePlanSegment(entry)
    if (!segment) {
      return null
    }
    segments.push(segment)
  }

  return { ok: true, segments, usage, model: result.model }
}

const MAPPING_METHODS = new Set(["identical-duration", "shot-sequence"])

function parseTimelineMap(value: unknown): SmartCropTimelineMapPayload | null {
  const map = asRecord(value)
  if (
    !map ||
    typeof map.mappingMethod !== "string" ||
    !MAPPING_METHODS.has(map.mappingMethod) ||
    typeof map.overallConfidence !== "number" ||
    typeof map.unmappedDurationPercent !== "number" ||
    typeof map.maxConsecutiveUnmappedSeconds !== "number" ||
    !Array.isArray(map.segments)
  ) {
    return null
  }

  const gate = asRecord(map.gate)
  if (
    !gate ||
    typeof gate.passed !== "boolean" ||
    !Array.isArray(gate.failures)
  ) {
    return null
  }
  const failures = gate.failures.filter(
    (entry): entry is string => typeof entry === "string",
  )
  const gateConfig: Record<string, number> = {}
  const rawGateConfig = asRecord(gate.config) ?? {}
  for (const [key, entry] of Object.entries(rawGateConfig)) {
    if (typeof entry === "number") {
      gateConfig[key] = entry
    }
  }

  const segments: SmartCropTimelineMapSegment[] = []
  for (const entry of map.segments) {
    const segment = asRecord(entry)
    if (
      !segment ||
      typeof segment.canonicalShotId !== "string" ||
      typeof segment.canonicalStart !== "number" ||
      typeof segment.canonicalEnd !== "number" ||
      typeof segment.localizedStart !== "number" ||
      typeof segment.localizedEnd !== "number" ||
      typeof segment.confidence !== "number"
    ) {
      return null
    }
    segments.push({
      canonicalShotId: segment.canonicalShotId,
      canonicalStart: segment.canonicalStart,
      canonicalEnd: segment.canonicalEnd,
      localizedStart: segment.localizedStart,
      localizedEnd: segment.localizedEnd,
      confidence: segment.confidence,
    })
  }

  const warnings = Array.isArray(map.warnings)
    ? map.warnings.filter((entry): entry is string => typeof entry === "string")
    : []

  return {
    mappingMethod: map.mappingMethod as "identical-duration" | "shot-sequence",
    overallConfidence: map.overallConfidence,
    unmappedDurationPercent: map.unmappedDurationPercent,
    maxConsecutiveUnmappedSeconds: map.maxConsecutiveUnmappedSeconds,
    segments,
    gate: { passed: gate.passed, failures, config: gateConfig },
    warnings,
  }
}

function parseAlignResult(value: unknown): SmartCropAlignLaunchResult | null {
  const record = asRecord(value)
  const result = asRecord(record?.result)
  if (!result || typeof result.ok !== "boolean") return null

  if (result.ok === false) {
    return parseFailure(result)
  }

  const timelineMap = parseTimelineMap(result.timelineMap)
  if (!timelineMap) {
    return null
  }

  return { ok: true, timelineMap }
}

const QA_VERDICTS = new Set(["pass", "needs_repair", "fail"])
const QA_SEVERITIES = new Set(["info", "warning", "critical"])

function parseQaResult(value: unknown): SmartCropQaLaunchResult | null {
  const record = asRecord(value)
  const result = asRecord(record?.result)
  if (!result || typeof result.ok !== "boolean") return null

  if (result.ok === false) {
    return parseFailure(result)
  }

  if (
    typeof result.verdict !== "string" ||
    !QA_VERDICTS.has(result.verdict) ||
    !Array.isArray(result.issues) ||
    typeof result.model !== "string"
  ) {
    return null
  }
  const usage = parseUsage(result.usage)
  if (!usage) {
    return null
  }

  const issues: SmartCropQaIssue[] = []
  for (const entry of result.issues) {
    const issue = asRecord(entry)
    if (
      !issue ||
      typeof issue.severity !== "string" ||
      !QA_SEVERITIES.has(issue.severity) ||
      typeof issue.description !== "string"
    ) {
      return null
    }
    issues.push({
      severity: issue.severity as SmartCropQaIssue["severity"],
      description: issue.description,
      atSeconds:
        typeof issue.atSeconds === "number" ? issue.atSeconds : undefined,
      shotId: typeof issue.shotId === "string" ? issue.shotId : undefined,
    })
  }

  return {
    ok: true,
    verdict: result.verdict as "pass" | "needs_repair" | "fail",
    issues,
    usage,
    model: result.model,
  }
}

function parseRepairResult(value: unknown): SmartCropRepairLaunchResult | null {
  const record = asRecord(value)
  const result = asRecord(record?.result)
  if (!result || typeof result.ok !== "boolean") return null

  if (result.ok === false) {
    return parseFailure(result)
  }

  if (!Array.isArray(result.segments) || typeof result.model !== "string") {
    return null
  }
  const usage = parseUsage(result.usage)
  if (!usage) {
    return null
  }

  const segments: SmartCropPlanSegment[] = []
  for (const entry of result.segments) {
    const segment = parsePlanSegment(entry)
    if (!segment) {
      return null
    }
    segments.push(segment)
  }

  return { ok: true, segments, usage, model: result.model }
}

type PostToMastraOutcome =
  | { kind: "payload"; payload: unknown; httpOk: boolean; httpStatus: number }
  | { kind: "failure"; failure: MastraSmartCropFailure }

async function postToMastra(
  path: string,
  body: unknown,
  options: LaunchMastraSmartCropOptions,
): Promise<PostToMastraOutcome> {
  const baseUrl = options.baseUrl ?? env.MASTRA_BASE_URL
  const bearer = options.bearer ?? env.MASTRA_SERVICE_API_KEY
  if (!baseUrl || !bearer) {
    return {
      kind: "failure",
      failure: { ok: false, reason: "config_missing", retryable: false },
    }
  }

  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(new URL(path, baseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(
        options.timeoutMs ??
          env.MASTRA_SMART_CROP_TIMEOUT_MS ??
          DEFAULT_TIMEOUT_MS,
      ),
    })
  } catch {
    return {
      kind: "failure",
      failure: { ok: false, reason: "network_error", retryable: true },
    }
  }

  if (response.status === 401) {
    return {
      kind: "failure",
      failure: { ok: false, reason: "auth_failed", retryable: false },
    }
  }

  return {
    kind: "payload",
    payload: await response.json().catch(() => undefined),
    httpOk: response.ok,
    httpStatus: response.status,
  }
}

function finalizeResult<T>(
  outcome: PostToMastraOutcome,
  parse: (payload: unknown) => T | null,
): T | MastraSmartCropFailure {
  if (outcome.kind === "failure") {
    return outcome.failure
  }

  const parsed = parse(outcome.payload)
  if (parsed) {
    return parsed
  }

  if (!outcome.httpOk) {
    return {
      ok: false,
      reason: "network_error",
      retryable: outcome.httpStatus >= 500 || outcome.httpStatus === 429,
    }
  }

  return { ok: false, reason: "parse_error", retryable: true }
}

export async function launchSmartCropPlan(
  input: SmartCropPlanLaunchInput,
  options: LaunchMastraSmartCropOptions = {},
): Promise<SmartCropPlanLaunchResult> {
  const outcome = await postToMastra("/forge-smart-crop-plan", input, options)
  return finalizeResult(outcome, parsePlanResult)
}

export async function launchSmartCropAlign(
  input: SmartCropAlignLaunchInput,
  options: LaunchMastraSmartCropOptions = {},
): Promise<SmartCropAlignLaunchResult> {
  const outcome = await postToMastra("/forge-smart-crop-align", input, options)
  return finalizeResult(outcome, parseAlignResult)
}

export async function launchSmartCropQa(
  input: SmartCropQaLaunchInput,
  options: LaunchMastraSmartCropOptions = {},
): Promise<SmartCropQaLaunchResult> {
  const outcome = await postToMastra("/forge-smart-crop-qa", input, options)
  return finalizeResult(outcome, parseQaResult)
}

export async function launchSmartCropRepair(
  input: SmartCropRepairLaunchInput,
  options: LaunchMastraSmartCropOptions = {},
): Promise<SmartCropRepairLaunchResult> {
  const outcome = await postToMastra("/forge-smart-crop-repair", input, options)
  return finalizeResult(outcome, parseRepairResult)
}

export const _internals = {
  parsePlanResult,
  parseAlignResult,
  parseQaResult,
  parseRepairResult,
}

export type SmartCropPlanKeyframe = {
  progress: number
  x: number
  y: number
  width: number
  height: number
}

export type SmartCropPlanSegment = {
  shotId: string
  canonicalStart: number
  canonicalEnd: number
  mode: string
  primarySubject: string
  confidence: number
  cropKeyframes: SmartCropPlanKeyframe[]
}

export type SmartCropPlanForPlayer = {
  playbackId: string
  source: {
    width: number
    height: number
    durationSeconds: number
  }
  segments: SmartCropPlanSegment[]
}

export type SmartCropQaIssueForPlayer = {
  severity: "info" | "warning" | "critical"
  description: string
  atSeconds?: number
  shotId?: string
}

export type SmartCropQaMarkerForPlayer = SmartCropQaIssueForPlayer & {
  markerId: string
  seconds: number
  percent: number
  segment?: SmartCropPlanSegment
}

export type CropBoxPercent = {
  left: number
  top: number
  width: number
  height: number
}

export function isSmartCropAttemptSelectableForReview(status: string): boolean {
  return ["approved", "complete", "qa_unavailable"].includes(status)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function parseQaIssue(value: unknown): SmartCropQaIssueForPlayer | null {
  if (!isRecord(value)) return null
  if (
    value.severity !== "info" &&
    value.severity !== "warning" &&
    value.severity !== "critical"
  ) {
    return null
  }
  if (typeof value.description !== "string") return null

  return {
    severity: value.severity,
    description: value.description,
    atSeconds: asFiniteNumber(value.atSeconds) ?? undefined,
    shotId: asString(value.shotId) ?? undefined,
  }
}

export function parseSmartCropQaIssuesForPlayer(
  value: unknown,
): SmartCropQaIssueForPlayer[] {
  if (!isRecord(value) || !Array.isArray(value.issues)) return []

  return value.issues.map(parseQaIssue).filter((issue) => issue != null)
}

function parseKeyframe(value: unknown): SmartCropPlanKeyframe | null {
  if (!isRecord(value)) return null

  const progress = asFiniteNumber(value.progress)
  const x = asFiniteNumber(value.x)
  const y = asFiniteNumber(value.y)
  const width = asFiniteNumber(value.width)
  const height = asFiniteNumber(value.height)

  if (
    progress == null ||
    x == null ||
    y == null ||
    width == null ||
    height == null ||
    progress < 0 ||
    progress > 1 ||
    width <= 0 ||
    height <= 0
  ) {
    return null
  }

  return { progress, x, y, width, height }
}

function parseSegment(value: unknown): SmartCropPlanSegment | null {
  if (!isRecord(value)) return null

  const shotId = asString(value.shotId)
  const canonicalStart = asFiniteNumber(value.canonicalStart)
  const canonicalEnd = asFiniteNumber(value.canonicalEnd)
  const mode = asString(value.mode)
  const primarySubject = asString(value.primarySubject) ?? "Subject"
  const confidence = asFiniteNumber(value.confidence) ?? 0
  const cropKeyframes = Array.isArray(value.cropKeyframes)
    ? value.cropKeyframes.map(parseKeyframe).filter((item) => item != null)
    : []

  if (
    shotId == null ||
    canonicalStart == null ||
    canonicalEnd == null ||
    mode == null ||
    canonicalEnd <= canonicalStart ||
    cropKeyframes.length === 0
  ) {
    return null
  }

  return {
    shotId,
    canonicalStart,
    canonicalEnd,
    mode,
    primarySubject,
    confidence,
    cropKeyframes,
  }
}

export function parseSmartCropPlanForPlayer(
  value: unknown,
): SmartCropPlanForPlayer | null {
  if (!isRecord(value)) return null

  const playbackId = asString(value.playbackId)
  const source = isRecord(value.source) ? value.source : null
  const width = source ? asFiniteNumber(source.width) : null
  const height = source ? asFiniteNumber(source.height) : null
  const durationSeconds = source ? asFiniteNumber(source.durationSeconds) : null
  const segments = Array.isArray(value.segments)
    ? value.segments.map(parseSegment).filter((item) => item != null)
    : []

  if (
    playbackId == null ||
    width == null ||
    height == null ||
    durationSeconds == null ||
    width <= 0 ||
    height <= 0 ||
    durationSeconds <= 0 ||
    segments.length === 0
  ) {
    return null
  }

  return {
    playbackId,
    source: { width, height, durationSeconds },
    segments,
  }
}

export function findActiveSmartCropSegment(
  segments: readonly SmartCropPlanSegment[],
  currentTimeSeconds: number,
): SmartCropPlanSegment | null {
  if (segments.length === 0) return null

  const active = segments.find(
    (segment) =>
      currentTimeSeconds >= segment.canonicalStart &&
      currentTimeSeconds < segment.canonicalEnd,
  )
  if (active) return active

  if (currentTimeSeconds < segments[0]!.canonicalStart) {
    return segments[0]!
  }

  return segments[segments.length - 1]!
}

export function buildSmartCropQaMarkers(
  segments: readonly SmartCropPlanSegment[],
  issues: readonly SmartCropQaIssueForPlayer[],
  durationSeconds: number,
): SmartCropQaMarkerForPlayer[] {
  if (segments.length === 0 || durationSeconds <= 0) return []

  return issues
    .map((issue, index): SmartCropQaMarkerForPlayer | null => {
      const explicitSeconds = asFiniteNumber(issue.atSeconds)
      const shotSegment = issue.shotId
        ? segments.find((segment) => segment.shotId === issue.shotId)
        : undefined
      const seconds =
        explicitSeconds ??
        (shotSegment
          ? (shotSegment.canonicalStart + shotSegment.canonicalEnd) / 2
          : null)

      if (seconds == null) return null

      const clampedSeconds = Math.min(durationSeconds, Math.max(0, seconds))
      const activeSegment =
        shotSegment ?? findActiveSmartCropSegment(segments, clampedSeconds)

      return {
        ...issue,
        markerId: `${issue.shotId ?? "time"}-${index}-${issue.severity}`,
        seconds: clampedSeconds,
        percent: (clampedSeconds / durationSeconds) * 100,
        ...(activeSegment ? { segment: activeSegment } : {}),
      }
    })
    .filter((marker) => marker != null)
    .sort((left, right) => left.seconds - right.seconds)
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * progress
}

export function interpolateSmartCropKeyframe(
  segment: SmartCropPlanSegment,
  currentTimeSeconds: number,
): SmartCropPlanKeyframe | null {
  const keyframes = [...segment.cropKeyframes].sort(
    (left, right) => left.progress - right.progress,
  )
  const first = keyframes[0]
  if (!first) return null
  if (keyframes.length === 1) return first

  const segmentDuration = segment.canonicalEnd - segment.canonicalStart
  const segmentProgress =
    segmentDuration > 0
      ? Math.min(
          1,
          Math.max(
            0,
            (currentTimeSeconds - segment.canonicalStart) / segmentDuration,
          ),
        )
      : 0

  let previous = first
  for (const next of keyframes.slice(1)) {
    if (segmentProgress > next.progress) {
      previous = next
      continue
    }

    const span = next.progress - previous.progress
    const localProgress =
      span > 0 ? (segmentProgress - previous.progress) / span : 0

    return {
      progress: segmentProgress,
      x: interpolate(previous.x, next.x, localProgress),
      y: interpolate(previous.y, next.y, localProgress),
      width: interpolate(previous.width, next.width, localProgress),
      height: interpolate(previous.height, next.height, localProgress),
    }
  }

  return keyframes[keyframes.length - 1]!
}

export function buildSmartCropBoxPercent(
  keyframe: SmartCropPlanKeyframe,
  source: SmartCropPlanForPlayer["source"],
): CropBoxPercent {
  return {
    left: (keyframe.x / source.width) * 100,
    top: (keyframe.y / source.height) * 100,
    width: (keyframe.width / source.width) * 100,
    height: (keyframe.height / source.height) * 100,
  }
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

export function clampSmartCropBoxPercent(box: CropBoxPercent): CropBoxPercent {
  const left = clampPercent(box.left)
  const top = clampPercent(box.top)

  return {
    left,
    top,
    width: Math.min(clampPercent(box.width), 100 - left),
    height: Math.min(clampPercent(box.height), 100 - top),
  }
}

export function formatSmartCropTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds)
  const mins = Math.floor(safeSeconds / 60)
  const secs = Math.floor(safeSeconds % 60)
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

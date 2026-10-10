export type SubtitleCue = {
  id: string
  startSeconds: number
  endSeconds: number
  text: string
}

export type AlignedSubtitleSegment = {
  id: string
  startSeconds: number
  endSeconds: number
  sourceText: string
  trackAText: string
  trackBText: string
  lexicalDifference: boolean
  timingDifference: boolean
}

const TIMING_DIFFERENCE_SECONDS = 0.05
const MAX_LOOP_SECONDS = 30

export function parseWebVtt(value: string): SubtitleCue[] {
  const normalized = value
    .replace(/^\uFEFF/, "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
  const blocks = normalized.split(/\n{2,}/)
  const cues: SubtitleCue[] = []

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line, index, all) => line.length > 0 || index < all.length - 1)
    if (lines.length === 0) continue
    const first = lines[0]?.trim() ?? ""
    if (
      first === "WEBVTT" ||
      first.startsWith("WEBVTT ") ||
      first === "NOTE" ||
      first.startsWith("NOTE ") ||
      first === "STYLE" ||
      first === "REGION"
    ) {
      continue
    }

    const timingIndex = lines.findIndex((line) => line.includes("-->"))
    if (timingIndex < 0) continue
    const [rawStart, rawEndWithSettings] = lines[timingIndex]!.split("-->")
    const rawEnd = rawEndWithSettings?.trim().split(/\s+/, 1)[0]
    const startSeconds = parseTimestamp(rawStart?.trim() ?? "")
    const endSeconds = parseTimestamp(rawEnd ?? "")
    if (
      startSeconds == null ||
      endSeconds == null ||
      endSeconds <= startSeconds
    ) {
      continue
    }

    const text = cleanCueText(lines.slice(timingIndex + 1).join("\n"))
    cues.push({
      id: `cue-${cues.length + 1}`,
      startSeconds,
      endSeconds,
      text,
    })
  }

  return cues.sort(
    (left, right) =>
      left.startSeconds - right.startSeconds ||
      left.endSeconds - right.endSeconds,
  )
}

export function alignSubtitleSegments(input: {
  source: readonly SubtitleCue[]
  trackA: readonly SubtitleCue[]
  trackB: readonly SubtitleCue[]
  locale?: string
}): AlignedSubtitleSegment[] {
  const components = connectedCueComponents(input)

  return components.map((group, index) => {
    const startSeconds = Math.min(...group.map(({ cue }) => cue.startSeconds))
    const endSeconds = Math.max(...group.map(({ cue }) => cue.endSeconds))
    const sourceCues = cuesForTrack(group, "source")
    const trackACues = cuesForTrack(group, "A")
    const trackBCues = cuesForTrack(group, "B")
    const trackAText = joinCueText(trackACues)
    const trackBText = joinCueText(trackBCues)

    return {
      id: `segment-${String(index + 1).padStart(4, "0")}`,
      startSeconds,
      endSeconds,
      sourceText: joinCueText(sourceCues),
      trackAText,
      trackBText,
      lexicalDifference: trackAText !== trackBText,
      timingDifference: hasTimingDifference(trackACues, trackBCues),
    }
  })
}

export function navigateSegmentIndex(
  currentIndex: number,
  delta: -1 | 1,
  segmentCount: number,
): number {
  if (segmentCount <= 0) return 0
  return Math.min(segmentCount - 1, Math.max(0, currentIndex + delta))
}

export function findActiveSegmentIndex(
  segments: readonly AlignedSubtitleSegment[],
  currentTime: number,
): number {
  const exact = segments.findIndex(
    (segment) =>
      currentTime >= segment.startSeconds && currentTime < segment.endSeconds,
  )
  if (exact >= 0) return exact
  const next = segments.findIndex(
    (segment) => currentTime < segment.startSeconds,
  )
  return next >= 0 ? next : Math.max(0, segments.length - 1)
}

export function boundSegmentWindow(
  clipStartSeconds: number,
  clipEndSeconds: number,
  segment: Pick<AlignedSubtitleSegment, "startSeconds" | "endSeconds">,
) {
  const startSeconds = Math.max(clipStartSeconds, segment.startSeconds)
  return {
    startSeconds,
    endSeconds: Math.min(
      clipEndSeconds,
      segment.endSeconds,
      startSeconds + MAX_LOOP_SECONDS,
    ),
  }
}

export function formatSubtitleTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const minutes = Math.floor(safeSeconds / 60)
  const remainder = Math.floor(safeSeconds % 60)
  return `${minutes}:${remainder.toString().padStart(2, "0")}`
}

function parseTimestamp(value: string): number | null {
  const parts = value.replace(",", ".").split(":")
  if (parts.length < 2 || parts.length > 3) return null
  const seconds = Number(parts.at(-1))
  const minutes = Number(parts.at(-2))
  const hours = parts.length === 3 ? Number(parts[0]) : 0
  if (
    !Number.isFinite(seconds) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(hours) ||
    seconds < 0 ||
    seconds >= 60 ||
    minutes < 0 ||
    minutes >= 60 ||
    hours < 0
  ) {
    return null
  }
  return hours * 3_600 + minutes * 60 + seconds
}

function cleanCueText(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, "")).trim()
}

function decodeEntities(value: string): string {
  return value.replace(
    /&(?:amp|lt|gt|nbsp|#39|quot|#x[0-9a-f]+|#[0-9]+);/gi,
    (entity) => {
      const named: Record<string, string> = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&nbsp;": " ",
        "&#39;": "'",
        "&quot;": '"',
      }
      const normalized = entity.toLowerCase()
      if (named[normalized]) return named[normalized]
      const isHex = normalized.startsWith("&#x")
      const codePoint = Number.parseInt(
        normalized.slice(isHex ? 3 : 2, -1),
        isHex ? 16 : 10,
      )
      return Number.isSafeInteger(codePoint)
        ? String.fromCodePoint(codePoint)
        : entity
    },
  )
}

function joinCueText(cues: readonly SubtitleCue[]) {
  return cues
    .map((cue) => cue.text)
    .filter(Boolean)
    .join("\n")
}

function hasTimingDifference(
  trackA: readonly SubtitleCue[],
  trackB: readonly SubtitleCue[],
) {
  const leftBounds = cueBounds(trackA)
  const rightBounds = cueBounds(trackB)
  if (!leftBounds || !rightBounds) return false
  return (
    Math.abs(leftBounds.startSeconds - rightBounds.startSeconds) >
      TIMING_DIFFERENCE_SECONDS ||
    Math.abs(leftBounds.endSeconds - rightBounds.endSeconds) >
      TIMING_DIFFERENCE_SECONDS
  )
}

type TrackName = "source" | "A" | "B"
type CueNode = { cue: SubtitleCue; index: number; track: TrackName }

function connectedCueComponents(input: {
  source: readonly SubtitleCue[]
  trackA: readonly SubtitleCue[]
  trackB: readonly SubtitleCue[]
}): CueNode[][] {
  const comparisonNodes = (["A", "B"] as const).flatMap((track) =>
    (track === "A" ? input.trackA : input.trackB).map((cue, index) => ({
      cue,
      index,
      track,
    })),
  )
  const comparisonComponents = groupOverlappingNodes(comparisonNodes)
  const sourceNodes: CueNode[] = input.source.map((cue, index) => ({
    cue,
    index,
    track: "source",
  }))
  const attachedSourceIndexes = new Set<number>()
  const components = comparisonComponents.map((component) => {
    const startSeconds = Math.min(
      ...component.map(({ cue }) => cue.startSeconds),
    )
    const endSeconds = Math.max(...component.map(({ cue }) => cue.endSeconds))
    const source = sourceNodes.filter(({ cue, index }) => {
      const overlaps =
        cue.endSeconds > startSeconds && cue.startSeconds < endSeconds
      if (overlaps) attachedSourceIndexes.add(index)
      return overlaps
    })
    return [...component, ...source]
  })
  const sourceOnlyComponents = groupOverlappingNodes(
    sourceNodes.filter(({ index }) => !attachedSourceIndexes.has(index)),
  )
  return [...components, ...sourceOnlyComponents].sort(
    (left, right) =>
      Math.min(...left.map(({ cue }) => cue.startSeconds)) -
      Math.min(...right.map(({ cue }) => cue.startSeconds)),
  )
}

function groupOverlappingNodes(nodes: readonly CueNode[]): CueNode[][] {
  const sorted = [...nodes].sort(
    (left, right) =>
      left.cue.startSeconds - right.cue.startSeconds ||
      left.cue.endSeconds - right.cue.endSeconds ||
      left.track.localeCompare(right.track) ||
      left.index - right.index,
  )
  const components: CueNode[][] = []
  let componentEnd = Number.NEGATIVE_INFINITY
  for (const node of sorted) {
    const current = components.at(-1)
    if (!current || node.cue.startSeconds >= componentEnd) {
      components.push([node])
      componentEnd = node.cue.endSeconds
    } else {
      current.push(node)
      componentEnd = Math.max(componentEnd, node.cue.endSeconds)
    }
  }
  return components
}

function cuesForTrack(component: readonly CueNode[], track: TrackName) {
  return component
    .filter((node) => node.track === track)
    .sort(
      (left, right) =>
        left.cue.startSeconds - right.cue.startSeconds ||
        left.index - right.index,
    )
    .map(({ cue }) => cue)
}

function cueBounds(cues: readonly SubtitleCue[]) {
  if (cues.length === 0) return undefined
  return {
    startSeconds: Math.min(...cues.map((cue) => cue.startSeconds)),
    endSeconds: Math.max(...cues.map((cue) => cue.endSeconds)),
  }
}

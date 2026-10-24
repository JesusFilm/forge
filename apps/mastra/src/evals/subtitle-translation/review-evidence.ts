import {
  SubtitleEvalReviewEvidenceSchema,
  type SubtitleEvalReviewEvidence,
} from "./types"
import type { VttCue } from "./vtt"

const MAX_LCS_TOKENS = 1_024
const TIMING_DIFFERENCE_SECONDS = 0.05

type IndexedCue = VttCue & { index: number }
type TrackName = "source" | "reference" | "candidate"
type CueNode = IndexedCue & { track: TrackName }
type DiffOperation =
  SubtitleEvalReviewEvidence["segments"][number]["lexicalDiff"][number]

export function buildSubtitleReviewEvidence(input: {
  locale: string
  source: readonly VttCue[]
  reference: readonly VttCue[]
  candidate: readonly VttCue[]
}): SubtitleEvalReviewEvidence {
  const components = connectedCueComponents({
    source: input.source,
    reference: input.reference,
    candidate: input.candidate,
  })
  const evidence = {
    schemaVersion: "subtitle-translation-review-evidence/v1" as const,
    alignment: "connected-time-overlap/v1" as const,
    diff: "intl-word-grapheme-safe/v1" as const,
    locale: input.locale,
    segments: components.map((component, index) => {
      const source = cuesForTrack(component, "source")
      const reference = cuesForTrack(component, "reference")
      const candidate = cuesForTrack(component, "candidate")
      const referenceBounds = cueBounds(reference)
      const candidateBounds = cueBounds(candidate)
      const referenceText = reference.map((cue) => cue.text).join("\n")
      const candidateText = candidate.map((cue) => cue.text).join("\n")
      const flags: Array<
        "text_diff" | "timing_diff" | "reference_only" | "candidate_only"
      > = []
      if (referenceText !== candidateText) flags.push("text_diff")
      if (reference.length > 0 && candidate.length === 0) {
        flags.push("reference_only")
      }
      if (candidate.length > 0 && reference.length === 0) {
        flags.push("candidate_only")
      }
      const startDeltaSeconds = delta(
        candidateBounds?.start,
        referenceBounds?.start,
      )
      const endDeltaSeconds = delta(candidateBounds?.end, referenceBounds?.end)
      if (
        (startDeltaSeconds != null &&
          Math.abs(startDeltaSeconds) > TIMING_DIFFERENCE_SECONDS) ||
        (endDeltaSeconds != null &&
          Math.abs(endDeltaSeconds) > TIMING_DIFFERENCE_SECONDS)
      ) {
        flags.push("timing_diff")
      }

      return {
        id: `segment-${String(index + 1).padStart(4, "0")}`,
        start: Math.min(...component.map((cue) => cue.start)),
        end: Math.max(...component.map((cue) => cue.end)),
        source,
        reference,
        candidate,
        lexicalDiff: diffSubtitleText(
          referenceText,
          candidateText,
          input.locale,
        ),
        timing: {
          referenceStart: referenceBounds?.start ?? null,
          referenceEnd: referenceBounds?.end ?? null,
          candidateStart: candidateBounds?.start ?? null,
          candidateEnd: candidateBounds?.end ?? null,
          startDeltaSeconds,
          endDeltaSeconds,
        },
        flags,
      }
    }),
  }
  return SubtitleEvalReviewEvidenceSchema.parse(evidence)
}

export function diffSubtitleText(
  reference: string,
  candidate: string,
  locale: string,
): DiffOperation[] {
  if (reference === candidate) {
    return reference ? [{ kind: "equal", text: reference }] : []
  }
  const left = segmentWords(reference, locale)
  const right = segmentWords(candidate, locale)
  if (left.length > MAX_LCS_TOKENS || right.length > MAX_LCS_TOKENS) {
    return boundedGraphemeDiff(reference, candidate, locale)
  }

  const rows = Array.from(
    { length: left.length + 1 },
    () => new Uint16Array(right.length + 1),
  )
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex--) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex--) {
      rows[leftIndex]![rightIndex] =
        left[leftIndex] === right[rightIndex]
          ? rows[leftIndex + 1]![rightIndex + 1]! + 1
          : Math.max(
              rows[leftIndex + 1]![rightIndex]!,
              rows[leftIndex]![rightIndex + 1]!,
            )
    }
  }

  const operations: DiffOperation[] = []
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < left.length || rightIndex < right.length) {
    if (
      leftIndex < left.length &&
      rightIndex < right.length &&
      left[leftIndex] === right[rightIndex]
    ) {
      pushOperation(operations, "equal", left[leftIndex]!)
      leftIndex++
      rightIndex++
    } else if (
      rightIndex < right.length &&
      (leftIndex === left.length ||
        rows[leftIndex]![rightIndex + 1]! >= rows[leftIndex + 1]![rightIndex]!)
    ) {
      pushOperation(operations, "insert", right[rightIndex]!)
      rightIndex++
    } else {
      pushOperation(operations, "delete", left[leftIndex]!)
      leftIndex++
    }
  }
  return operations
}

function connectedCueComponents(input: {
  source: readonly VttCue[]
  reference: readonly VttCue[]
  candidate: readonly VttCue[]
}): CueNode[][] {
  const comparisonNodes = (["reference", "candidate"] as const).flatMap(
    (track) => input[track].map((cue, index) => ({ ...cue, index, track })),
  )
  const comparisonComponents = groupOverlappingNodes(comparisonNodes)
  const sourceNodes: CueNode[] = input.source.map((cue, index) => ({
    ...cue,
    index,
    track: "source",
  }))
  const attachedSourceIndexes = new Set<number>()
  const components = comparisonComponents.map((component) => {
    const start = Math.min(...component.map((cue) => cue.start))
    const end = Math.max(...component.map((cue) => cue.end))
    const source = sourceNodes.filter((cue) => {
      const overlaps = cue.end > start && cue.start < end
      if (overlaps) attachedSourceIndexes.add(cue.index)
      return overlaps
    })
    return [...component, ...source]
  })
  const sourceOnlyComponents = groupOverlappingNodes(
    sourceNodes.filter((cue) => !attachedSourceIndexes.has(cue.index)),
  )
  return [...components, ...sourceOnlyComponents].sort(
    (left, right) =>
      Math.min(...left.map((cue) => cue.start)) -
      Math.min(...right.map((cue) => cue.start)),
  )
}

function groupOverlappingNodes(nodes: readonly CueNode[]): CueNode[][] {
  const sorted = [...nodes].sort(
    (left, right) =>
      left.start - right.start ||
      left.end - right.end ||
      left.track.localeCompare(right.track) ||
      left.index - right.index,
  )

  const components: CueNode[][] = []
  let componentEnd = Number.NEGATIVE_INFINITY
  for (const node of sorted) {
    const current = components.at(-1)
    if (!current || node.start >= componentEnd) {
      components.push([node])
      componentEnd = node.end
    } else {
      current.push(node)
      componentEnd = Math.max(componentEnd, node.end)
    }
  }
  return components
}

function cuesForTrack(component: readonly CueNode[], track: TrackName) {
  return component
    .filter((cue) => cue.track === track)
    .map(({ index, start, end, text }) => ({ index, start, end, text }))
    .sort((left, right) => left.start - right.start || left.index - right.index)
}

function cueBounds(cues: readonly IndexedCue[]) {
  if (cues.length === 0) return undefined
  return {
    start: Math.min(...cues.map((cue) => cue.start)),
    end: Math.max(...cues.map((cue) => cue.end)),
  }
}

function delta(left: number | undefined, right: number | undefined) {
  return left == null || right == null
    ? null
    : Number((left - right).toFixed(3))
}

function segmentWords(value: string, locale: string): string[] {
  try {
    return Array.from(
      new Intl.Segmenter(locale, { granularity: "word" }).segment(value),
      (part) => part.segment,
    )
  } catch {
    return segmentGraphemes(value, locale)
  }
}

function segmentGraphemes(value: string, locale: string): string[] {
  try {
    return Array.from(
      new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(value),
      (part) => part.segment,
    )
  } catch {
    // A whole-string token is less granular but never corrupts a combining
    // sequence or ZWJ emoji. Do not fall back to Array.from/code points.
    return value ? [value] : []
  }
}

function boundedGraphemeDiff(
  reference: string,
  candidate: string,
  locale: string,
): DiffOperation[] {
  const left = segmentGraphemes(reference, locale)
  const right = segmentGraphemes(candidate, locale)
  let prefix = 0
  while (prefix < left.length && left[prefix] === right[prefix]) prefix++
  let suffix = 0
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) {
    suffix++
  }
  const operations: DiffOperation[] = []
  pushOperation(operations, "equal", left.slice(0, prefix).join(""))
  pushOperation(
    operations,
    "delete",
    left.slice(prefix, left.length - suffix).join(""),
  )
  pushOperation(
    operations,
    "insert",
    right.slice(prefix, right.length - suffix).join(""),
  )
  if (suffix > 0) {
    pushOperation(
      operations,
      "equal",
      left.slice(left.length - suffix).join(""),
    )
  }
  return operations
}

function pushOperation(
  operations: DiffOperation[],
  kind: DiffOperation["kind"],
  text: string,
): void {
  if (!text) return
  const previous = operations.at(-1)
  if (previous?.kind === kind) previous.text += text
  else operations.push({ kind, text })
}

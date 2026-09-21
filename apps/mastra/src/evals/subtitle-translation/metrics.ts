import type { SubtitleEvalAutomaticMetrics } from "./types"
import type { VttCue } from "./vtt"

const MAX_GENERATED_CUE_DURATION_SECONDS = 7.5
const MIN_SOURCE_SPEECH_COVERAGE = 0.95
const TIMING_EPSILON_SECONDS = 0.05
const COVERAGE_EPSILON = 0.000_001
const WINDOW_SECONDS = 30

export function compareSubtitleCues(input: {
  source: readonly VttCue[]
  generated: readonly VttCue[]
  reference: readonly VttCue[]
  clipStartSeconds: number
  clipEndSeconds: number
}): SubtitleEvalAutomaticMetrics {
  const failures: string[] = []
  const warnings: string[] = []
  const generated = input.generated

  if (generated.length === 0) failures.push("no_generated_cues")
  for (let index = 0; index < generated.length; index++) {
    const cue = generated[index]!
    if (![cue.start, cue.end].every(Number.isFinite)) {
      failures.push(`cue_${index}:non_finite_timing`)
      continue
    }
    if (cue.end <= cue.start) failures.push(`cue_${index}:end_not_after_start`)
    if (!cue.text.trim()) failures.push(`cue_${index}:empty_text`)
    if (cue.end - cue.start > MAX_GENERATED_CUE_DURATION_SECONDS) {
      failures.push(`cue_${index}:duration_exceeds_7_5_seconds`)
    }
    if (
      cue.start < input.clipStartSeconds - TIMING_EPSILON_SECONDS ||
      cue.end > input.clipEndSeconds + TIMING_EPSILON_SECONDS
    ) {
      failures.push(`cue_${index}:outside_clip_window`)
    }

    const previous = generated[index - 1]
    if (previous && cue.start < previous.end - TIMING_EPSILON_SECONDS) {
      failures.push(`cue_${index}:overlaps_previous_cue`)
    }
    if (
      previous &&
      normalizeForComparison(previous.text) === normalizeForComparison(cue.text)
    ) {
      failures.push(`cue_${index}:duplicates_previous_cue`)
    }
  }

  const sourceSpeechCoverage = intervalRecall(generated, input.source)
  const referenceSourceSpeechCoverage = intervalRecall(
    input.reference,
    input.source,
  )
  const requiredSourceSpeechCoverage = Math.min(
    MIN_SOURCE_SPEECH_COVERAGE,
    referenceSourceSpeechCoverage,
  )
  if (sourceSpeechCoverage + COVERAGE_EPSILON < requiredSourceSpeechCoverage) {
    failures.push("source_speech_coverage_below_human_reference_floor")
  }
  if (referenceSourceSpeechCoverage < MIN_SOURCE_SPEECH_COVERAGE) {
    warnings.push("human_reference_source_coverage_below_0_95")
  }

  const generatedText = joinCueText(generated)
  const referenceText = joinCueText(input.reference)
  const generatedCharacterCount = countComparisonCharacters(generatedText)
  const referenceCharacterCount = countComparisonCharacters(referenceText)
  const textCharacterNgramFScore = characterNgramFScore(
    generatedText,
    referenceText,
  )
  if (textCharacterNgramFScore < 0.25) {
    warnings.push("very_low_reference_text_similarity")
  }

  const readability = summarizeReadability(generated)
  if (readability.charactersPerSecondP95 > 25) {
    warnings.push("characters_per_second_p95_above_25")
  }
  if (readability.maximumLineLength > 84) {
    warnings.push("maximum_line_length_above_84")
  }

  return {
    structural: {
      passed: failures.length === 0,
      failures,
      warnings,
      sourceSpeechCoverage: round(sourceSpeechCoverage),
    },
    text: {
      characterNgramFScore: round(textCharacterNgramFScore),
      windowedCharacterNgramFScore: round(windowedCharacterNgramFScore(input)),
      generatedCharacterCount,
      referenceCharacterCount,
      lengthRatio:
        referenceCharacterCount === 0
          ? null
          : round(generatedCharacterCount / referenceCharacterCount),
    },
    timing: {
      referenceOverlapPrecision: round(
        intervalPrecision(generated, input.reference),
      ),
      referenceOverlapRecall: round(intervalRecall(generated, input.reference)),
      boundaryMeanAbsoluteErrorSeconds: boundaryMeanAbsoluteError(
        generated,
        input.reference,
      ),
    },
    readability,
  }
}

export function characterNgramFScore(
  candidate: string,
  reference: string,
  maximumOrder = 6,
  beta = 2,
): number {
  const candidateText = normalizeForComparison(candidate).replaceAll(" ", "")
  const referenceText = normalizeForComparison(reference).replaceAll(" ", "")
  if (!candidateText || !referenceText)
    return candidateText === referenceText ? 1 : 0

  const scores: number[] = []
  for (let order = 1; order <= maximumOrder; order++) {
    const candidateNgrams = ngramCounts(candidateText, order)
    const referenceNgrams = ngramCounts(referenceText, order)
    if (candidateNgrams.size === 0 || referenceNgrams.size === 0) continue

    let matches = 0
    for (const [ngram, count] of candidateNgrams) {
      matches += Math.min(count, referenceNgrams.get(ngram) ?? 0)
    }
    const candidateTotal = sumCounts(candidateNgrams)
    const referenceTotal = sumCounts(referenceNgrams)
    const precision = matches / candidateTotal
    const recall = matches / referenceTotal
    const betaSquared = beta * beta
    const denominator = betaSquared * precision + recall
    scores.push(
      denominator === 0
        ? 0
        : ((1 + betaSquared) * precision * recall) / denominator,
    )
  }
  return scores.length === 0
    ? 0
    : scores.reduce((sum, score) => sum + score, 0) / scores.length
}

export function normalizeForComparison(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .replace(/<[^>]+>/g, "")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function windowedCharacterNgramFScore(input: {
  generated: readonly VttCue[]
  reference: readonly VttCue[]
  clipStartSeconds: number
  clipEndSeconds: number
}): number {
  const scores: number[] = []
  for (
    let start = input.clipStartSeconds;
    start < input.clipEndSeconds;
    start += WINDOW_SECONDS
  ) {
    const end = Math.min(start + WINDOW_SECONDS, input.clipEndSeconds)
    const referenceText = joinCueText(
      cuesOverlapping(input.reference, start, end),
    )
    if (!normalizeForComparison(referenceText)) continue
    const generatedText = joinCueText(
      cuesOverlapping(input.generated, start, end),
    )
    scores.push(characterNgramFScore(generatedText, referenceText))
  }
  return scores.length === 0
    ? 0
    : scores.reduce((sum, score) => sum + score, 0) / scores.length
}

function cuesOverlapping(
  cues: readonly VttCue[],
  start: number,
  end: number,
): VttCue[] {
  return cues.filter((cue) => cue.end > start && cue.start < end)
}

function joinCueText(cues: readonly VttCue[]): string {
  return cues.map((cue) => cue.text).join(" ")
}

function countComparisonCharacters(value: string): number {
  return Array.from(normalizeForComparison(value).replaceAll(" ", "")).length
}

function ngramCounts(value: string, order: number): Map<string, number> {
  const characters = Array.from(value)
  const counts = new Map<string, number>()
  for (let index = 0; index <= characters.length - order; index++) {
    const ngram = characters.slice(index, index + order).join("")
    counts.set(ngram, (counts.get(ngram) ?? 0) + 1)
  }
  return counts
}

function sumCounts(counts: ReadonlyMap<string, number>): number {
  let total = 0
  for (const count of counts.values()) total += count
  return total
}

function intervalPrecision(
  candidate: readonly VttCue[],
  reference: readonly VttCue[],
): number {
  const candidateIntervals = mergeIntervals(candidate)
  const candidateDuration = intervalDuration(candidateIntervals)
  if (candidateDuration === 0) return reference.length === 0 ? 1 : 0
  return (
    intervalIntersectionDuration(
      candidateIntervals,
      mergeIntervals(reference),
    ) / candidateDuration
  )
}

function intervalRecall(
  candidate: readonly VttCue[],
  reference: readonly VttCue[],
): number {
  const referenceIntervals = mergeIntervals(reference)
  const referenceDuration = intervalDuration(referenceIntervals)
  if (referenceDuration === 0) return candidate.length === 0 ? 1 : 0
  return (
    intervalIntersectionDuration(
      mergeIntervals(candidate),
      referenceIntervals,
    ) / referenceDuration
  )
}

type Interval = { start: number; end: number }

function mergeIntervals(cues: readonly VttCue[]): Interval[] {
  const sorted = cues
    .filter((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end))
    .map((cue) => ({ start: cue.start, end: cue.end }))
    .filter((interval) => interval.end > interval.start)
    .sort((left, right) => left.start - right.start || left.end - right.end)
  const merged: Interval[] = []
  for (const interval of sorted) {
    const previous = merged.at(-1)
    if (!previous || interval.start > previous.end) {
      merged.push({ ...interval })
    } else {
      previous.end = Math.max(previous.end, interval.end)
    }
  }
  return merged
}

function intervalDuration(intervals: readonly Interval[]): number {
  return intervals.reduce(
    (sum, interval) => sum + interval.end - interval.start,
    0,
  )
}

function intervalIntersectionDuration(
  left: readonly Interval[],
  right: readonly Interval[],
): number {
  let leftIndex = 0
  let rightIndex = 0
  let total = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftInterval = left[leftIndex]!
    const rightInterval = right[rightIndex]!
    total += Math.max(
      0,
      Math.min(leftInterval.end, rightInterval.end) -
        Math.max(leftInterval.start, rightInterval.start),
    )
    if (leftInterval.end < rightInterval.end) leftIndex++
    else rightIndex++
  }
  return total
}

function boundaryMeanAbsoluteError(
  generated: readonly VttCue[],
  reference: readonly VttCue[],
): number | null {
  const referenceBoundaries = reference
    .flatMap((cue) => [cue.start, cue.end])
    .filter(Number.isFinite)
  if (generated.length === 0 || referenceBoundaries.length === 0) return null

  const errors = generated.flatMap((cue) =>
    [cue.start, cue.end].map((boundary) =>
      Math.min(
        ...referenceBoundaries.map((referenceBoundary) =>
          Math.abs(boundary - referenceBoundary),
        ),
      ),
    ),
  )
  return round(errors.reduce((sum, error) => sum + error, 0) / errors.length)
}

function summarizeReadability(
  cues: readonly VttCue[],
): SubtitleEvalAutomaticMetrics["readability"] {
  const charactersPerSecond = cues
    .map((cue) => {
      const duration = cue.end - cue.start
      return duration > 0
        ? Array.from(cue.text.replace(/\s/g, "")).length / duration
        : 0
    })
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  const lineLengths = cues.flatMap((cue) =>
    cue.text.split("\n").map((line) => Array.from(line).length),
  )
  return {
    cueCount: cues.length,
    charactersPerSecondP50: round(percentile(charactersPerSecond, 0.5)),
    charactersPerSecondP95: round(percentile(charactersPerSecond, 0.95)),
    charactersPerSecondMax: round(charactersPerSecond.at(-1) ?? 0),
    maximumLineLength: Math.max(0, ...lineLengths),
  }
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0
  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.ceil(values.length * quantile) - 1),
  )
  return values[index]!
}

function round(value: number): number {
  return Number(value.toFixed(4))
}

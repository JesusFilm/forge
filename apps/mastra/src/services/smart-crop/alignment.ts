/**
 * Deterministic shot alignment between a canonical and a localized
 * smart-crop fingerprint. Pure functions only — no I/O, no env reads.
 *
 * Tier 1 ("identical-duration"): near-identical total durations with equal
 * shot counts map 1:1 at confidence 0.99.
 * Tier 2 ("shot-sequence"): global monotonic alignment (Needleman-Wunsch)
 * scored by duration similarity + dhash Hamming similarity.
 */

export const SMART_CROP_GATE_DEFAULTS = {
  minOverallConfidence: 0.92,
  minShotConfidence: 0.85,
  maxUnmappedDurationPercent: 5,
  maxConsecutiveUnmappedSeconds: 20,
  maxTimingDriftSecondsPerShot: 5,
} as const

export type SmartCropGateConfig = {
  minOverallConfidence: number
  minShotConfidence: number
  maxUnmappedDurationPercent: number
  maxConsecutiveUnmappedSeconds: number
  maxTimingDriftSecondsPerShot: number
}

export const SMART_CROP_GATE_FAILURES = [
  "overall_confidence_below_min",
  "unmapped_duration_above_max",
  "consecutive_unmapped_above_max",
  "timing_drift_above_max",
] as const

export type SmartCropGateFailure = (typeof SMART_CROP_GATE_FAILURES)[number]

export const SMART_CROP_MAPPING_METHODS = [
  "identical-duration",
  "shot-sequence",
] as const

export type SmartCropMappingMethod = (typeof SMART_CROP_MAPPING_METHODS)[number]

export type SmartCropFingerprintShot = {
  shotId: string
  start: number
  end: number
  representativeHashes?: readonly { time: number; dhash: string }[]
}

export type SmartCropFingerprintForAlignment = {
  source: { durationSeconds: number }
  shots: readonly SmartCropFingerprintShot[]
}

export type SmartCropTimelineMapSegment = {
  canonicalShotId: string
  canonicalStart: number
  canonicalEnd: number
  localizedStart: number
  localizedEnd: number
  confidence: number
}

export type SmartCropTimelineMap = {
  mappingMethod: SmartCropMappingMethod
  overallConfidence: number
  unmappedDurationPercent: number
  maxConsecutiveUnmappedSeconds: number
  segments: SmartCropTimelineMapSegment[]
  gate: {
    passed: boolean
    failures: SmartCropGateFailure[]
    config: SmartCropGateConfig
  }
  warnings: string[]
}

export type AlignFingerprintsInput = {
  canonical: SmartCropFingerprintForAlignment
  localized: SmartCropFingerprintForAlignment
  gates?: Partial<SmartCropGateConfig>
  planShotIds?: readonly string[]
}

const IDENTICAL_DURATION_DELTA_FRACTION = 0.005
const IDENTICAL_DURATION_CONFIDENCE = 0.99
const GAP_PENALTY = -0.4
const HASH_BITS = 64
const NEUTRAL_HASH_SIMILARITY = 0.5

const POPCOUNT_NIBBLE = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4]

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function shotDuration(shot: SmartCropFingerprintShot): number {
  return Math.max(0, shot.end - shot.start)
}

function hammingDistance64(a: string, b: string): number {
  let distance = 0
  for (let index = 0; index < 16; index += 1) {
    const left = parseInt(a[index] ?? "0", 16)
    const right = parseInt(b[index] ?? "0", 16)
    distance += POPCOUNT_NIBBLE[(left ^ right) & 0xf] ?? 0
  }
  return distance
}

function hashSimilarity(
  canonical: SmartCropFingerprintShot,
  localized: SmartCropFingerprintShot,
): number {
  const canonicalHashes = (canonical.representativeHashes ?? []).map((entry) =>
    entry.dhash.toLowerCase(),
  )
  const localizedHashes = (localized.representativeHashes ?? []).map((entry) =>
    entry.dhash.toLowerCase(),
  )
  if (canonicalHashes.length === 0 || localizedHashes.length === 0) {
    return NEUTRAL_HASH_SIMILARITY
  }

  let minDistance = HASH_BITS
  for (const canonicalHash of canonicalHashes) {
    for (const localizedHash of localizedHashes) {
      const distance = hammingDistance64(canonicalHash, localizedHash)
      if (distance < minDistance) minDistance = distance
    }
  }
  return 1 - minDistance / HASH_BITS
}

function durationSimilarity(
  canonical: SmartCropFingerprintShot,
  localized: SmartCropFingerprintShot,
): number {
  const canonicalDuration = shotDuration(canonical)
  const localizedDuration = shotDuration(localized)
  const maxDuration = Math.max(canonicalDuration, localizedDuration)
  if (maxDuration <= 0) return 1
  return (
    1 -
    Math.min(1, Math.abs(canonicalDuration - localizedDuration) / maxDuration)
  )
}

function pairScore(
  canonical: SmartCropFingerprintShot,
  localized: SmartCropFingerprintShot,
): number {
  return (
    0.5 * durationSimilarity(canonical, localized) +
    0.5 * hashSimilarity(canonical, localized)
  )
}

type MatchedPair = {
  canonicalIndex: number
  localizedIndex: number
  confidence: number
}

function needlemanWunschPairs(
  canonicalShots: readonly SmartCropFingerprintShot[],
  localizedShots: readonly SmartCropFingerprintShot[],
): MatchedPair[] {
  const n = canonicalShots.length
  const m = localizedShots.length
  const score: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  )
  // 0 = diagonal match, 1 = canonical gap (up), 2 = localized gap (left)
  const back: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  )

  for (let i = 1; i <= n; i += 1) {
    score[i]![0] = i * GAP_PENALTY
    back[i]![0] = 1
  }
  for (let j = 1; j <= m; j += 1) {
    score[0]![j] = j * GAP_PENALTY
    back[0]![j] = 2
  }

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const diagonal =
        score[i - 1]![j - 1]! +
        pairScore(canonicalShots[i - 1]!, localizedShots[j - 1]!)
      const up = score[i - 1]![j]! + GAP_PENALTY
      const left = score[i]![j - 1]! + GAP_PENALTY
      let best = diagonal
      let direction = 0
      if (up > best) {
        best = up
        direction = 1
      }
      if (left > best) {
        best = left
        direction = 2
      }
      score[i]![j] = best
      back[i]![j] = direction
    }
  }

  const pairs: MatchedPair[] = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    const direction = back[i]![j]!
    if (i > 0 && j > 0 && direction === 0) {
      pairs.push({
        canonicalIndex: i - 1,
        localizedIndex: j - 1,
        confidence: pairScore(canonicalShots[i - 1]!, localizedShots[j - 1]!),
      })
      i -= 1
      j -= 1
    } else if (i > 0 && (j === 0 || direction === 1)) {
      i -= 1
    } else {
      j -= 1
    }
  }
  pairs.reverse()
  return pairs
}

function isIdenticalDuration(
  canonical: SmartCropFingerprintForAlignment,
  localized: SmartCropFingerprintForAlignment,
): boolean {
  if (canonical.shots.length !== localized.shots.length) return false
  const canonicalDuration = canonical.source.durationSeconds
  const localizedDuration = localized.source.durationSeconds
  const maxDuration = Math.max(canonicalDuration, localizedDuration)
  if (maxDuration <= 0) return false
  return (
    Math.abs(canonicalDuration - localizedDuration) / maxDuration <
    IDENTICAL_DURATION_DELTA_FRACTION
  )
}

export function resolveGateConfig(
  gates?: Partial<SmartCropGateConfig>,
): SmartCropGateConfig {
  return { ...SMART_CROP_GATE_DEFAULTS, ...gates }
}

export function alignFingerprints({
  canonical,
  localized,
  gates,
  planShotIds,
}: AlignFingerprintsInput): SmartCropTimelineMap {
  const gateConfig = resolveGateConfig(gates)
  const canonicalShots = canonical.shots
  const localizedShots = localized.shots

  let mappingMethod: SmartCropMappingMethod
  let matchedPairs: MatchedPair[]
  if (isIdenticalDuration(canonical, localized)) {
    mappingMethod = "identical-duration"
    matchedPairs = canonicalShots.map((_, index) => ({
      canonicalIndex: index,
      localizedIndex: index,
      confidence: IDENTICAL_DURATION_CONFIDENCE,
    }))
  } else {
    mappingMethod = "shot-sequence"
    matchedPairs = needlemanWunschPairs(canonicalShots, localizedShots).filter(
      (pair) => pair.confidence >= gateConfig.minShotConfidence,
    )
  }

  const mappedByCanonicalIndex = new Map<number, MatchedPair>(
    matchedPairs.map((pair) => [pair.canonicalIndex, pair]),
  )

  const segments: SmartCropTimelineMapSegment[] = matchedPairs.map((pair) => {
    const canonicalShot = canonicalShots[pair.canonicalIndex]!
    const localizedShot = localizedShots[pair.localizedIndex]!
    return {
      canonicalShotId: canonicalShot.shotId,
      canonicalStart: canonicalShot.start,
      canonicalEnd: canonicalShot.end,
      localizedStart: localizedShot.start,
      localizedEnd: localizedShot.end,
      confidence: roundTo(pair.confidence, 6),
    }
  })

  let totalCanonicalDuration = 0
  let mappedCanonicalDuration = 0
  let confidenceWeightedSum = 0
  let unmappedRunSeconds = 0
  let maxConsecutiveUnmappedSeconds = 0
  for (let index = 0; index < canonicalShots.length; index += 1) {
    const shot = canonicalShots[index]!
    const duration = shotDuration(shot)
    totalCanonicalDuration += duration
    const pair = mappedByCanonicalIndex.get(index)
    if (pair) {
      mappedCanonicalDuration += duration
      confidenceWeightedSum += pair.confidence * duration
      unmappedRunSeconds = 0
    } else {
      unmappedRunSeconds += duration
      if (unmappedRunSeconds > maxConsecutiveUnmappedSeconds) {
        maxConsecutiveUnmappedSeconds = unmappedRunSeconds
      }
    }
  }

  const overallConfidence =
    mappedCanonicalDuration > 0
      ? confidenceWeightedSum / mappedCanonicalDuration
      : 0
  const unmappedDurationPercent =
    totalCanonicalDuration > 0
      ? ((totalCanonicalDuration - mappedCanonicalDuration) /
          totalCanonicalDuration) *
        100
      : 0

  let maxTimingDriftSeconds = 0
  let previousOffset: number | null = null
  for (const segment of segments) {
    const offset = segment.localizedStart - segment.canonicalStart
    if (previousOffset != null) {
      const drift = Math.abs(offset - previousOffset)
      if (drift > maxTimingDriftSeconds) maxTimingDriftSeconds = drift
    }
    previousOffset = offset
  }

  const failures: SmartCropGateFailure[] = []
  if (overallConfidence < gateConfig.minOverallConfidence) {
    failures.push("overall_confidence_below_min")
  }
  if (unmappedDurationPercent > gateConfig.maxUnmappedDurationPercent) {
    failures.push("unmapped_duration_above_max")
  }
  if (
    maxConsecutiveUnmappedSeconds > gateConfig.maxConsecutiveUnmappedSeconds
  ) {
    failures.push("consecutive_unmapped_above_max")
  }
  if (maxTimingDriftSeconds > gateConfig.maxTimingDriftSecondsPerShot) {
    failures.push("timing_drift_above_max")
  }

  const mappedShotIds = new Set(
    segments.map((segment) => segment.canonicalShotId),
  )
  const warnings: string[] = []
  for (const planShotId of planShotIds ?? []) {
    if (!mappedShotIds.has(planShotId)) {
      warnings.push(`plan_shot_unmapped:${planShotId}`)
    }
  }

  return {
    mappingMethod,
    overallConfidence: roundTo(overallConfidence, 6),
    unmappedDurationPercent: roundTo(unmappedDurationPercent, 6),
    maxConsecutiveUnmappedSeconds: roundTo(maxConsecutiveUnmappedSeconds, 6),
    segments,
    gate: { passed: failures.length === 0, failures, config: gateConfig },
    warnings,
  }
}

export const _internals = {
  hammingDistance64,
  hashSimilarity,
  durationSimilarity,
  pairScore,
  needlemanWunschPairs,
  isIdenticalDuration,
}

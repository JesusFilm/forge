import {
  classifyMatchStrength,
  roundConfidence,
  type PublicMatchCandidate,
} from "../domain/match.js"
import { mergeSignals, type RetrievalSignal } from "./retrieval/types.js"

export type FusionOptions = {
  limit?: number
  visualAnchorThreshold?: number
  visualCandidateFloor?: number
}

const DEFAULT_WEIGHTS = {
  visual: 0.5,
  audio: 0.25,
  text: 0.15,
  duration: 0.1,
}

export function fuseRankedCandidates(
  signals: RetrievalSignal[],
  {
    limit = 3,
    visualAnchorThreshold = 0.65,
    visualCandidateFloor = 0.2,
  }: FusionOptions = {},
): PublicMatchCandidate[] {
  const merged = mergeSignals(signals)
  const hasStrongVisualAnchor = merged.some(
    (signal) => (signal.visualScore ?? 0) >= visualAnchorThreshold,
  )
  const eligible = hasStrongVisualAnchor
    ? merged.filter(
        (signal) => (signal.visualScore ?? 0) >= visualCandidateFloor,
      )
    : merged

  return eligible
    .map((signal) => {
      const weighted = weightedConfidence(signal)
      const lacksStrongVisualAnchor =
        (signal.visualScore ?? 0) < visualAnchorThreshold
      const confidence = roundConfidence(
        lacksStrongVisualAnchor ? Math.min(weighted, 0.84) : weighted,
      )

      return {
        coreId: signal.coreId,
        videoVariantId: signal.videoVariantId,
        confidence,
        matchStrength: classifyMatchStrength(confidence),
      }
    })
    .sort(
      (left, right) =>
        right.confidence - left.confidence ||
        left.coreId.localeCompare(right.coreId) ||
        left.videoVariantId.localeCompare(right.videoVariantId),
    )
    .slice(0, limit)
}

function weightedConfidence(signal: RetrievalSignal): number {
  const weightedSignals = [
    [signal.visualScore, DEFAULT_WEIGHTS.visual],
    [signal.audioScore, DEFAULT_WEIGHTS.audio],
    [signal.textScore, DEFAULT_WEIGHTS.text],
    [signal.durationScore, DEFAULT_WEIGHTS.duration],
  ] as const

  const availableSignals = weightedSignals.filter(
    ([score]) => score !== undefined,
  )
  const weightTotal = availableSignals.reduce(
    (total, [, weight]) => total + weight,
    0,
  )

  if (weightTotal === 0) return 0

  return (
    availableSignals.reduce(
      (total, [score, weight]) => total + (score ?? 0) * weight,
      0,
    ) / weightTotal
  )
}

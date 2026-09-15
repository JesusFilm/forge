import {
  DETERMINISTIC_RANKER_VERSION,
  HYBRID_DETERMINISTIC_RANKER_VERSION,
} from "./candidate"
import type { EligibleCandidate } from "./eligibility"

const RRF_K = 60
const HYBRID_MAX_COMBINED_CONTRIBUTION = 1.05

type SemanticScoreExplanation = Readonly<{
  version: typeof DETERMINISTIC_RANKER_VERSION
  features: ReadonlyArray<
    Readonly<{
      name: "semantic_normalized"
      value: number
      weight: 1
      contribution: number
    }>
  >
}>

type HybridScoreExplanation = Readonly<{
  version: typeof HYBRID_DETERMINISTIC_RANKER_VERSION
  features: ReadonlyArray<
    Readonly<{
      name: "source_rank_primary" | "source_rank_secondary"
      sourceGenerator: string
      sourceRank: number
      value: number
      weight: 1 | 0.05
      contribution: number
    }>
  >
}>

export type ScoredCandidate = EligibleCandidate &
  Readonly<{
    normalizedSemanticScore: number
    rrfBenchmark: number
    deterministicScore: number
    scoreExplanation: SemanticScoreExplanation | HybridScoreExplanation
  }>

export type OrderedCandidate = ScoredCandidate &
  Readonly<{ orderedPosition: number }>

export function scoreAndOrderCandidates(
  candidates: readonly EligibleCandidate[],
): OrderedCandidate[] {
  if (candidates.length === 0) return []
  const rawScores = candidates.map(maximumAcceptedSourceScore)
  const minimum = Math.min(...rawScores)
  const maximum = Math.max(...rawScores)

  return candidates
    .map((candidate, index): ScoredCandidate => {
      const rawScore = rawScores[index] ?? 0
      const normalizedSemanticScore = roundScore(
        maximum === minimum ? 1 : (rawScore - minimum) / (maximum - minimum),
      )
      const rrfBenchmark = roundScore(
        candidate.sources
          .filter((source) => source.rejectionReason == null)
          .reduce((sum, source) => sum + 1 / (RRF_K + source.rank), 0),
      )
      return {
        ...candidate,
        normalizedSemanticScore,
        rrfBenchmark,
        deterministicScore: normalizedSemanticScore,
        scoreExplanation: {
          version: DETERMINISTIC_RANKER_VERSION,
          features: [
            {
              name: "semantic_normalized",
              value: normalizedSemanticScore,
              weight: 1,
              contribution: normalizedSemanticScore,
            },
          ],
        },
      }
    })
    .sort(compareDeterministicScore)
    .map((candidate, orderedPosition) => ({
      ...candidate,
      orderedPosition,
    }))
}

/**
 * Rank heterogeneous generators by their source-relative order. Semantic and
 * profile similarity magnitudes are intentionally incomparable and never
 * enter this score. A second independent source supplies only a small bounded
 * lift, so dual nomination helps without becoming an unconditional win.
 */
export function scoreAndOrderHybridCandidates(
  candidates: readonly EligibleCandidate[],
): OrderedCandidate[] {
  return candidates
    .map((candidate): ScoredCandidate => {
      const sourceFeatures = bestAcceptedRankPerGenerator(candidate)
        .map((source) => ({
          ...source,
          value: roundScore((RRF_K + 1) / (RRF_K + source.rank)),
        }))
        .sort(
          (left, right) =>
            right.value - left.value ||
            left.generator.localeCompare(right.generator),
        )
      const primary = sourceFeatures[0]
      const secondary = sourceFeatures[1]
      const primaryContribution = primary?.value ?? 0
      const secondaryContribution = roundScore((secondary?.value ?? 0) * 0.05)
      const semanticFeature =
        sourceFeatures.find((source) => source.generator === "semantic")
          ?.value ?? 0
      const rrfBenchmark = roundScore(
        candidate.sources
          .filter((source) => source.rejectionReason == null)
          .reduce((sum, source) => sum + 1 / (RRF_K + source.rank), 0),
      )
      const features: HybridScoreExplanation["features"] = [
        ...(primary
          ? [
              {
                name: "source_rank_primary" as const,
                sourceGenerator: primary.generator,
                sourceRank: primary.rank,
                value: primary.value,
                weight: 1 as const,
                contribution: primaryContribution,
              },
            ]
          : []),
        ...(secondary
          ? [
              {
                name: "source_rank_secondary" as const,
                sourceGenerator: secondary.generator,
                sourceRank: secondary.rank,
                value: secondary.value,
                weight: 0.05 as const,
                contribution: secondaryContribution,
              },
            ]
          : []),
      ]
      return {
        ...candidate,
        normalizedSemanticScore: semanticFeature,
        rrfBenchmark,
        // Stage evidence is contractually bounded to [0, 1]. Preserve every
        // source-rank distinction by normalizing the maximum possible 1.05
        // combined contribution instead of clamping top dual-source rows.
        deterministicScore: roundScore(
          (primaryContribution + secondaryContribution) /
            HYBRID_MAX_COMBINED_CONTRIBUTION,
        ),
        scoreExplanation: {
          version: HYBRID_DETERMINISTIC_RANKER_VERSION,
          features,
        },
      }
    })
    .sort(compareDeterministicScore)
    .map((candidate, orderedPosition) => ({
      ...candidate,
      orderedPosition,
    }))
}

function maximumAcceptedSourceScore(candidate: EligibleCandidate): number {
  const scores = candidate.sources
    .filter((source) => source.rejectionReason == null)
    .map((source) => source.score)
  return scores.length > 0 ? Math.max(...scores) : 0
}

function bestAcceptedRankPerGenerator(candidate: EligibleCandidate) {
  const best = new Map<string, number>()
  for (const source of candidate.sources) {
    if (source.rejectionReason != null) continue
    const current = best.get(source.generator)
    if (current == null || source.rank < current) {
      best.set(source.generator, source.rank)
    }
  }
  return [...best].map(([generator, rank]) => ({ generator, rank }))
}

function compareDeterministicScore(
  left: ScoredCandidate,
  right: ScoredCandidate,
): number {
  return (
    right.deterministicScore - left.deterministicScore ||
    left.targetMediaId.localeCompare(right.targetMediaId) ||
    left.presentation.sceneIndex - right.presentation.sceneIndex
  )
}

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

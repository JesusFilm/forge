import type { SearchEvalResult } from "./types"
import type {
  AbsoluteSearchEvalSplit,
  AbsoluteSearchIntent,
} from "./absolute-query-set"

export type AbsolutePointwiseRating =
  | "excellent"
  | "useful"
  | "weak"
  | "unacceptable"

export type AbsoluteSearchCaseObservation = {
  caseId: string
  split: AbsoluteSearchEvalSplit
  intent: AbsoluteSearchIntent
  locale: string
  expectedLanguageSlug?: string
  expectedNoResult?: boolean
  multilingual: boolean
  results: SearchEvalResult[]
  relevance: Record<string, 0 | 1 | 2 | 3>
  latencyMs: number
  degraded?: boolean
  pointwiseRating?: AbsolutePointwiseRating
}

export type AbsoluteSearchQuality = {
  queries: number
  evaluatedRelevanceCases: number
  successAt1: number
  successAt10: number
  mrr: number
  ndcgAt10: number
  productTitleSuccessAt1: number
  semanticIntentSuccessAt10: number
  multilingualSuccessAt10: number
  noResultRate: number
  expectedNoResultCases: number
  expectedNoResultAccuracy: number
  languageCorrectness: number
  canonicalDuplicateRate: number
  degradationRate: number
  pointwiseUsefulRate: number
  pointwiseUnacceptableRate: number
  latency: { p50Ms: number; p95Ms: number; p99Ms: number }
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length
}

function relevanceFor(
  observation: AbsoluteSearchCaseObservation,
  result: SearchEvalResult,
): number {
  return observation.relevance[result.canonicalVideoId ?? result.id] ?? 0
}

function discountedGain(grades: readonly number[]): number {
  return grades.reduce(
    (total, grade, index) => total + (2 ** grade - 1) / Math.log2(index + 2),
    0,
  )
}

function ndcgAt10(observation: AbsoluteSearchCaseObservation): number {
  const actual = observation.results
    .slice(0, 10)
    .map((result) => relevanceFor(observation, result))
  const ideal = Object.values(observation.relevance)
    .sort((left, right) => right - left)
    .slice(0, 10)
  const idealGain = discountedGain(ideal)
  return idealGain === 0 ? 0 : discountedGain(actual) / idealGain
}

function firstRelevantRank(
  observation: AbsoluteSearchCaseObservation,
): number | null {
  const index = observation.results.findIndex(
    (result) => relevanceFor(observation, result) > 0,
  )
  return index < 0 ? null : index + 1
}

function successAt(
  observations: readonly AbsoluteSearchCaseObservation[],
  rankLimit: number,
): number {
  return mean(
    observations.map((observation) => {
      const rank = firstRelevantRank(observation)
      return rank != null && rank <= rankLimit ? 1 : 0
    }),
  )
}

function quantile(values: readonly number[], percentile: number): number {
  if (values.length === 0) return 0
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.ceil(percentile * ordered.length) - 1] ?? ordered[0]
}

export function computeAbsoluteSearchQuality(
  observations: readonly AbsoluteSearchCaseObservation[],
): AbsoluteSearchQuality {
  const relevanceCases = observations.filter((entry) =>
    Object.values(entry.relevance).some((grade) => grade > 0),
  )
  const ranks = relevanceCases.map(firstRelevantRank)
  const productTitleCases = relevanceCases.filter(
    (entry) => entry.intent === "product-title",
  )
  const semanticIntentCases = relevanceCases.filter(
    (entry) => entry.intent === "semantic-intent",
  )
  const multilingualCases = relevanceCases.filter((entry) => entry.multilingual)
  const expectedNoResultCases = observations.filter(
    (entry) => entry.expectedNoResult,
  )
  const languageCases = observations.filter(
    (entry) => entry.expectedLanguageSlug != null && !entry.expectedNoResult,
  )
  const duplicateCounts = observations.map((entry) => {
    const identities = entry.results.map(
      (result) => result.canonicalVideoId ?? result.id,
    )
    return identities.length - new Set(identities).size
  })
  const resultCount = observations.reduce(
    (total, entry) => total + entry.results.length,
    0,
  )
  const pointwise = observations.flatMap((entry) =>
    entry.pointwiseRating == null ? [] : [entry.pointwiseRating],
  )
  const latencies = observations.map((entry) => entry.latencyMs)

  return {
    queries: observations.length,
    evaluatedRelevanceCases: relevanceCases.length,
    successAt1: mean(ranks.map((rank) => (rank === 1 ? 1 : 0))),
    successAt10: mean(
      ranks.map((rank) => (rank != null && rank <= 10 ? 1 : 0)),
    ),
    mrr: mean(ranks.map((rank) => (rank == null ? 0 : 1 / rank))),
    ndcgAt10: mean(relevanceCases.map(ndcgAt10)),
    productTitleSuccessAt1: successAt(productTitleCases, 1),
    semanticIntentSuccessAt10: successAt(semanticIntentCases, 10),
    multilingualSuccessAt10: successAt(multilingualCases, 10),
    noResultRate: mean(
      observations.map((entry) => (entry.results.length === 0 ? 1 : 0)),
    ),
    expectedNoResultCases: expectedNoResultCases.length,
    expectedNoResultAccuracy: mean(
      expectedNoResultCases.map((entry) =>
        entry.results.length === 0 ? 1 : 0,
      ),
    ),
    languageCorrectness: mean(
      languageCases.map((entry) =>
        entry.results.length > 0 &&
        entry.results.every(
          (result) => result.languageSlug === entry.expectedLanguageSlug,
        )
          ? 1
          : 0,
      ),
    ),
    canonicalDuplicateRate:
      resultCount === 0
        ? 0
        : duplicateCounts.reduce((total, count) => total + count, 0) /
          resultCount,
    degradationRate: mean(
      observations.map((entry) => (entry.degraded ? 1 : 0)),
    ),
    pointwiseUsefulRate: mean(
      pointwise.map((rating) =>
        rating === "excellent" || rating === "useful" ? 1 : 0,
      ),
    ),
    pointwiseUnacceptableRate: mean(
      pointwise.map((rating) => (rating === "unacceptable" ? 1 : 0)),
    ),
    latency: {
      p50Ms: quantile(latencies, 0.5),
      p95Ms: quantile(latencies, 0.95),
      p99Ms: quantile(latencies, 0.99),
    },
  }
}

import { createHash } from "node:crypto"
import { Prisma, RecommendationShadowDecisionKind } from "@prisma/client"
import {
  boundedScore,
  MAX_CANDIDATE_NOMINATIONS,
  type CandidateNomination,
  type RecommendationCandidateContext,
} from "../candidate"
import { evaluateCandidateEligibility } from "../eligibility"
import {
  scoreAndOrderCandidates,
  scoreAndOrderHybridCandidates,
} from "../ranker"
import { composeRecommendationSlate } from "../slate"
import { unionAndCanonicalizeCandidates } from "../union"

export const SHADOW_EVALUATION_POLICY_VERSION =
  "generic-shadow-candidate-evaluation-v1" as const
export const SHADOW_SAMPLING_VERSION = "stable-request-hash-v1" as const
export const SHADOW_RETENTION_POLICY_VERSION =
  "request-root-29d-aggregate-365d-v1" as const

export type ShadowEvaluationMetrics = Readonly<{
  coverage: number
  overlap: number
  novelty: number
  diversity: number
  rejection: number
  latencyMs: number
  cohortQuality: number | null
  inputFreshnessMs: number
}>

export type ShadowProjectionNomination = Readonly<{
  ordinal: number
  candidateKey: string
  targetMediaId: string
  generator: string
  generatorVersion: string
  sourceRank: number
  sourceScore: number
  eligible: boolean
  reasonCodes: string[]
  shadowPosition: number | null
  overlapsLive: boolean
  provenance: Readonly<Record<string, string | number | boolean | null>>
}>

export type ShadowProjectionResult = Readonly<{
  liveOrder: string[]
  shadowOrder: string[]
  liveSlateDigest: string
  shadowSlateDigest: string
  liveUnchanged: true
  metrics: ShadowEvaluationMetrics
  contributions: Array<Readonly<{ generator: string; count: number }>>
  nominations: ShadowProjectionNomination[]
}>

export function evaluateShadowProjection(input: {
  context: RecommendationCandidateContext
  liveOrder: readonly string[]
  nominations: readonly CandidateNomination[]
  limit: number
  projectionCapturedAt: Date | null
  evaluatedAt: Date
  latencyMs: number
  cohortQuality: number | null
  rankingMode?: "semantic" | "hybrid"
  currentVideoId?: string | null
}): ShadowProjectionResult {
  const boundedNominations = input.nominations.slice(
    0,
    MAX_CANDIDATE_NOMINATIONS,
  )
  const immutableLiveOrder = [...input.liveOrder].slice(0, 6)
  const union = unionAndCanonicalizeCandidates(boundedNominations)
  const eligibility = evaluateCandidateEligibility(
    union.candidates,
    input.context,
  )
  const ordered =
    input.rankingMode === "hybrid"
      ? scoreAndOrderHybridCandidates(eligibility.eligible)
      : scoreAndOrderCandidates(eligibility.eligible)
  const composed = composeRecommendationSlate(
    ordered,
    input.context,
    input.limit,
    input.rankingMode === "hybrid"
      ? { currentVideoId: input.currentVideoId }
      : {},
  ).composed
  const shadowOrder = composed.map((candidate) => candidate.targetMediaId)
  const liveSet = new Set(immutableLiveOrder)
  const overlapCount = shadowOrder.filter((id) => liveSet.has(id)).length
  const rejectionByNomination = new Map<string, string[]>()
  for (const rejected of eligibility.rejected) {
    for (const nomination of rejected.candidate.nominations) {
      rejectionByNomination.set(nomination.nominationKey, rejected.reasonCodes)
    }
  }
  const positionByCandidate = new Map(
    composed.map((candidate) => [
      candidate.candidateKey,
      candidate.composedPosition,
    ]),
  )
  const canonicalizationByNomination = new Map(
    union.canonicalizations.map((entry) => [entry.nominationKey, entry]),
  )
  const eligibleNominationKeys = new Set(
    eligibility.eligible.flatMap((candidate) =>
      candidate.nominations.map((nomination) => nomination.nominationKey),
    ),
  )
  const contributions = new Map<string, number>()
  for (const nomination of boundedNominations) {
    contributions.set(
      nomination.source.generator,
      (contributions.get(nomination.source.generator) ?? 0) + 1,
    )
  }

  return {
    liveOrder: immutableLiveOrder,
    shadowOrder,
    liveSlateDigest: digestIds(immutableLiveOrder),
    shadowSlateDigest: digestIds(shadowOrder),
    liveUnchanged: true,
    metrics: {
      coverage: ratio(
        shadowOrder.length,
        Math.max(1, Math.min(6, input.limit)),
      ),
      overlap: ratio(overlapCount, shadowOrder.length),
      novelty: ratio(shadowOrder.length - overlapCount, shadowOrder.length),
      diversity: themeDiversity(
        composed.map((candidate) => candidate.presentation.themes),
      ),
      rejection: ratio(
        boundedNominations.length - eligibleNominationKeys.size,
        boundedNominations.length,
      ),
      latencyMs: boundedInteger(input.latencyMs, 0, 60_000),
      cohortQuality:
        input.cohortQuality == null ? null : boundedRate(input.cohortQuality),
      inputFreshnessMs: boundedInteger(
        input.projectionCapturedAt == null
          ? 2_592_000_000
          : input.evaluatedAt.getTime() - input.projectionCapturedAt.getTime(),
        0,
        2_592_000_000,
      ),
    },
    contributions: [...contributions.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, 16)
      .map(([generator, count]) => ({ generator, count })),
    nominations: boundedNominations.map((nomination, ordinal) => {
      const canonical = canonicalizationByNomination.get(
        nomination.nominationKey,
      )
      const candidateKey = canonical?.candidateKey ?? nomination.targetMediaId
      return {
        ordinal,
        candidateKey,
        targetMediaId: nomination.targetMediaId,
        generator: nomination.source.generator.slice(0, 64),
        generatorVersion: nomination.source.generatorVersion.slice(0, 64),
        sourceRank: boundedInteger(nomination.source.rank, 1, 64),
        sourceScore: boundedScore(nomination.source.score),
        eligible: eligibleNominationKeys.has(nomination.nominationKey),
        reasonCodes: (
          rejectionByNomination.get(nomination.nominationKey) ?? []
        ).slice(0, 16),
        shadowPosition: positionByCandidate.get(candidateKey) ?? null,
        overlapsLive: liveSet.has(candidateKey),
        provenance: sanitizeProvenance(nomination.source.evidence),
      }
    }),
  }
}

export type ShadowTerminalDecision = Readonly<{
  decision: "promote_to_experiment" | "revise" | "retire" | "inconclusive"
  reasonCode: string
  reevaluationCondition: string
}>

export function decideShadowEvaluation(input: {
  metrics: ShadowEvaluationMetrics
  processedRuns: number
  minimumRuns: number
}): ShadowTerminalDecision {
  const minimumRuns = boundedInteger(input.minimumRuns, 1, 100_000)
  if (input.processedRuns < minimumRuns) {
    return {
      decision: "inconclusive",
      reasonCode: "insufficient_shadow_samples",
      reevaluationCondition: `collect_at_least_${minimumRuns}_processed_shadow_runs`,
    }
  }
  if (input.metrics.coverage < 0.25 || input.metrics.rejection > 0.75) {
    return {
      decision: "retire",
      reasonCode: "candidate_quality_below_floor",
      reevaluationCondition:
        "new_generator_manifest_with_coverage_at_least_0_25_and_rejection_at_most_0_75",
    }
  }
  if (
    input.metrics.latencyMs > 1_500 ||
    input.metrics.inputFreshnessMs > 86_400_000
  ) {
    return {
      decision: "revise",
      reasonCode: "shadow_operational_guardrail_failed",
      reevaluationCondition:
        "latency_at_most_1500ms_and_projection_freshness_at_most_24h",
    }
  }
  if (input.metrics.cohortQuality == null) {
    return {
      decision: "inconclusive",
      reasonCode: "cohort_quality_unavailable",
      reevaluationCondition: "publish_privacy_safe_cohort_quality",
    }
  }
  return {
    decision: "promote_to_experiment",
    reasonCode: "shadow_evidence_meets_policy",
    reevaluationCondition: "reopen_if_manifest_or_eligibility_version_changes",
  }
}

function themeDiversity(themeSets: readonly string[][]): number {
  if (themeSets.length <= 1) return themeSets.length
  let distance = 0
  let pairs = 0
  for (let left = 0; left < themeSets.length; left += 1) {
    for (let right = left + 1; right < themeSets.length; right += 1) {
      const leftSet = new Set(themeSets[left] ?? [])
      const rightSet = new Set(themeSets[right] ?? [])
      const union = new Set([...leftSet, ...rightSet])
      const intersection = [...leftSet].filter((value) => rightSet.has(value))
      distance += union.size === 0 ? 1 : 1 - intersection.length / union.size
      pairs += 1
    }
  }
  return boundedRate(distance / Math.max(1, pairs))
}

function sanitizeProvenance(
  value: Readonly<Record<string, string | number | boolean | null>>,
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 16)
      .filter(
        ([key]) =>
          /^[a-z][a-zA-Z0-9]{0,63}$/.test(key) &&
          !/(query|vector|profile|cohort|cookie|token|session)/i.test(key),
      )
      .map(([key, entry]) => [
        key,
        typeof entry === "string" ? entry.slice(0, 128) : entry,
      ]),
  )
}

export function digestIds(ids: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(ids)).digest("hex")
}

export function digestShadowValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

export function latestShadowDate(values: readonly Date[]): Date | null {
  return values.length === 0
    ? null
    : new Date(Math.max(...values.map((value) => value.getTime())))
}

export function safeShadowLiveItem(
  item: {
    targetMediaId: string
    position: number
    presentation: Prisma.JsonValue
  },
  locale: string,
) {
  const presentation = shadowObjectValue(item.presentation)
  return {
    targetMediaId: item.targetMediaId,
    position: item.position,
    presentation: {
      videoSlug: shadowStringValue(
        presentation.videoSlug,
        item.targetMediaId,
        191,
      ),
      videoTitle: shadowStringValue(
        presentation.videoTitle,
        item.targetMediaId,
        512,
      ),
      imageUrl: shadowNullableString(presentation.imageUrl, 2_048),
      sceneIndex: shadowNumberValue(presentation.sceneIndex, 0),
      description: shadowStringValue(presentation.description, "", 1_000),
      startSeconds: shadowNumberValue(presentation.startSeconds, 0),
      endSeconds: shadowNullableNumber(presentation.endSeconds),
      themes: shadowStringArray(presentation.themes),
      demographics: shadowStringArray(presentation.demographics),
      spiritualContext: shadowStringArray(presentation.spiritualContext),
      playbackId: shadowStringValue(presentation.playbackId, "", 512),
      locale,
      audioLanguageSlug: shadowStringValue(
        presentation.audioLanguageSlug,
        "",
        64,
      ),
      watchPlayable: true,
      localePublished: true,
    },
  }
}

export function aggregateShadowMetrics(
  runs: ReadonlyArray<{
    coverage: number | null
    overlap: number | null
    novelty: number | null
    diversity: number | null
    rejection: number | null
    latencyMs: number | null
    cohortQuality: number | null
    inputFreshnessMs: number | null
  }>,
): ShadowEvaluationMetrics {
  return {
    coverage: shadowAverage(runs.map((run) => run.coverage)),
    overlap: shadowAverage(runs.map((run) => run.overlap)),
    novelty: shadowAverage(runs.map((run) => run.novelty)),
    diversity: shadowAverage(runs.map((run) => run.diversity)),
    rejection: shadowAverage(runs.map((run) => run.rejection)),
    latencyMs: shadowPercentile95(runs.map((run) => run.latencyMs)),
    cohortQuality: shadowNullableAverage(runs.map((run) => run.cohortQuality)),
    inputFreshnessMs: shadowPercentile95(
      runs.map((run) => run.inputFreshnessMs),
    ),
  }
}

export function shadowDecisionEnum(
  value: string,
): RecommendationShadowDecisionKind {
  if (value === "promote_to_experiment")
    return RecommendationShadowDecisionKind.PROMOTE_TO_EXPERIMENT
  if (value === "revise") return RecommendationShadowDecisionKind.REVISE
  if (value === "retire") return RecommendationShadowDecisionKind.RETIRE
  return RecommendationShadowDecisionKind.INCONCLUSIVE
}

export function shadowDecisionName(
  value: RecommendationShadowDecisionKind,
): string {
  return value.toLowerCase()
}

function shadowAverage(values: readonly (number | null)[]): number {
  return shadowNullableAverage(values) ?? 0
}

function shadowNullableAverage(
  values: readonly (number | null)[],
): number | null {
  const present = values.filter((value): value is number => value != null)
  if (present.length === 0) return null
  return (
    Math.round(
      (present.reduce((sum, value) => sum + value, 0) / present.length) *
        1_000_000,
    ) / 1_000_000
  )
}

function shadowPercentile95(values: readonly (number | null)[]): number {
  const present = values
    .filter((value): value is number => value != null)
    .sort((left, right) => left - right)
  if (present.length === 0) return 0
  return present[Math.max(0, Math.ceil(present.length * 0.95) - 1)] ?? 0
}

function shadowObjectValue(
  value: Prisma.JsonValue,
): Record<string, Prisma.JsonValue> {
  return typeof value === "object" && value != null && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {}
}

function shadowStringValue(
  value: Prisma.JsonValue | undefined,
  fallback: string,
  length: number,
): string {
  return typeof value === "string" ? value.slice(0, length) : fallback
}

function shadowNullableString(
  value: Prisma.JsonValue | undefined,
  length: number,
): string | null {
  return typeof value === "string" ? value.slice(0, length) : null
}

function shadowNumberValue(
  value: Prisma.JsonValue | undefined,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function shadowNullableNumber(
  value: Prisma.JsonValue | undefined,
): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function shadowStringArray(value: Prisma.JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .slice(0, 16)
        .map((item) => item.slice(0, 64))
    : []
}

function ratio(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : boundedRate(numerator / denominator)
}

function boundedRate(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(Math.max(0, Math.min(1, value)) * 1_000_000) / 1_000_000
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value)) return minimum
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)))
}

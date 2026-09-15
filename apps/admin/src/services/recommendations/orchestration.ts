import { createHash } from "node:crypto"
import { dedupeByVideoIdentity } from "@/services/video-dedup"
import {
  CANDIDATE_CONTEXT_VERSION,
  CANDIDATE_ELIGIBILITY_VERSION,
  CANDIDATE_UNION_VERSION,
  DETERMINISTIC_RANKER_VERSION,
  HYBRID_DETERMINISTIC_RANKER_VERSION,
  HYBRID_SLATE_COMPOSER_VERSION,
  MINIMAL_SLATE_VERSION,
  MAX_CANDIDATE_NOMINATIONS,
  SEMANTIC_CANDIDATE_GENERATOR_VERSION,
  adaptSemanticCandidates,
  type CandidateNomination,
  type CandidateSourceEvidence,
  type RecommendationCandidateContext,
  type SemanticCandidatePoolItem,
} from "./candidate"
import {
  evaluateCandidateEligibility,
  nominationEligibilityReasons,
} from "./eligibility"
import {
  scoreAndOrderCandidates,
  scoreAndOrderHybridCandidates,
} from "./ranker"
import {
  composeMinimalSlate,
  composeRecommendationSlate,
  type RecommendationSlateComposition,
  type RecommendationSlateCompositionResult,
} from "./slate"
import { unionAndCanonicalizeCandidates } from "./union"

export const CANDIDATE_PLATFORM_STAGES = [
  "nominated",
  "canonicalized",
  "deduplicated",
  "rejected",
  "scored",
  "ordered",
  "composed",
] as const
export type CandidatePlatformStage = (typeof CANDIDATE_PLATFORM_STAGES)[number]

export type CandidateStageEvidence = Readonly<{
  stage: CandidatePlatformStage
  ordinal: number
  candidateKey: string
  targetMediaId: string | null
  sourceGenerator: string | null
  sourceRank: number | null
  sourceScore: number | null
  normalizedScore: number | null
  rrfScore: number | null
  deterministicScore: number | null
  finalPosition: number | null
  reasonCodes: string[]
  sourceEvidence: CandidateSourceEvidence[]
}>

export type SemanticCandidatePlatformResult = Readonly<{
  stageOrder: typeof CANDIDATE_PLATFORM_STAGES
  versions: Readonly<{
    context: typeof CANDIDATE_CONTEXT_VERSION
    generator: typeof SEMANTIC_CANDIDATE_GENERATOR_VERSION
    union: typeof CANDIDATE_UNION_VERSION
    eligibility: typeof CANDIDATE_ELIGIBILITY_VERSION
    ranker: typeof DETERMINISTIC_RANKER_VERSION
    composer: typeof MINIMAL_SLATE_VERSION
  }>
  counts: Readonly<Record<CandidatePlatformStage, number>>
  evidence: CandidateStageEvidence[]
  ordered: ReturnType<typeof scoreAndOrderCandidates>
  composed: ReturnType<typeof composeMinimalSlate>
  composition: RecommendationSlateCompositionResult
  parity: Readonly<{
    candidateEligibility: "passed" | "failed" | "not_evaluated"
    ranker: "passed" | "failed" | "not_evaluated"
    baselineDigest: string
    platformDigest: string
  }>
}>

export type CandidatePlatformResult = Omit<
  SemanticCandidatePlatformResult,
  "versions"
> &
  Readonly<{
    versions: Readonly<{
      context: string
      generator: string
      union: string
      eligibility: string
      ranker: string
      composer: string
    }>
  }>

type CandidateAdapterRejection = Readonly<{
  candidateKey: string
  targetMediaId: string | null
  generator: string
  reasonCode: string
}>

type CandidatePipelineResult = Readonly<{
  evidence: CandidateStageEvidence[]
  eligibleTargetMediaIds: string[]
  ordered: ReturnType<typeof scoreAndOrderCandidates>
  composed: ReturnType<typeof composeMinimalSlate>
  composition: RecommendationSlateCompositionResult
}>

/** Common online seam used by approved non-semantic generators. */
export function runCandidatePlatform(input: {
  nominations: readonly CandidateNomination[]
  context: RecommendationCandidateContext
  limit: number
  generatorVersion: string
  composition?: RecommendationSlateComposition
}): CandidatePlatformResult {
  const pipeline = runCandidatePipeline({
    nominations: input.nominations,
    context: input.context,
    limit: input.limit,
    composition: input.composition,
    rank: scoreAndOrderHybridCandidates,
    rankerReasonCode: HYBRID_DETERMINISTIC_RANKER_VERSION,
  })
  return {
    stageOrder: CANDIDATE_PLATFORM_STAGES,
    versions: {
      context: CANDIDATE_CONTEXT_VERSION,
      generator: input.generatorVersion,
      union: CANDIDATE_UNION_VERSION,
      eligibility: CANDIDATE_ELIGIBILITY_VERSION,
      ranker: HYBRID_DETERMINISTIC_RANKER_VERSION,
      composer: HYBRID_SLATE_COMPOSER_VERSION,
    },
    counts: Object.fromEntries(
      CANDIDATE_PLATFORM_STAGES.map((stage) => [
        stage,
        pipeline.evidence.filter((entry) => entry.stage === stage).length,
      ]),
    ) as Record<CandidatePlatformStage, number>,
    evidence: pipeline.evidence,
    ordered: pipeline.ordered,
    composed: pipeline.composed,
    composition: pipeline.composition,
    parity: {
      candidateEligibility: "not_evaluated",
      ranker: "not_evaluated",
      baselineDigest: "",
      platformDigest: digestIds(
        pipeline.composed.map((candidate) => candidate.targetMediaId),
      ),
    },
  }
}

export function runSemanticCandidatePlatform(input: {
  candidates: readonly SemanticCandidatePoolItem[]
  context: RecommendationCandidateContext
  limit: number
  composition?: RecommendationSlateComposition
}): SemanticCandidatePlatformResult {
  const adapter = adaptSemanticCandidates(input.candidates, input.context)
  const pipeline = runCandidatePipeline({
    nominations: adapter.nominations,
    adapterRejections: adapter.rejections,
    context: input.context,
    limit: input.limit,
    composition: input.composition,
    rank: scoreAndOrderCandidates,
    rankerReasonCode: DETERMINISTIC_RANKER_VERSION,
  })

  const baselineOrder = legacySemanticOrder(
    adapter.nominations,
    input.context,
    input.limit,
  )
  const platformEligibility = [...pipeline.eligibleTargetMediaIds].sort()
  const baselineEligibility = [...new Set(baselineOrder.eligibleIds)].sort()
  const platformOrder = pipeline.composed.map(
    (candidate) => candidate.targetMediaId,
  )
  const candidateEligibility = sameIds(baselineEligibility, platformEligibility)
    ? "passed"
    : "failed"
  const ranker = sameIds(baselineOrder.orderedIds, platformOrder)
    ? "passed"
    : "failed"

  return {
    stageOrder: CANDIDATE_PLATFORM_STAGES,
    versions: {
      context: CANDIDATE_CONTEXT_VERSION,
      generator: SEMANTIC_CANDIDATE_GENERATOR_VERSION,
      union: CANDIDATE_UNION_VERSION,
      eligibility: CANDIDATE_ELIGIBILITY_VERSION,
      ranker: DETERMINISTIC_RANKER_VERSION,
      composer: MINIMAL_SLATE_VERSION,
    },
    counts: Object.fromEntries(
      CANDIDATE_PLATFORM_STAGES.map((stage) => [
        stage,
        pipeline.evidence.filter((entry) => entry.stage === stage).length,
      ]),
    ) as Record<CandidatePlatformStage, number>,
    evidence: pipeline.evidence,
    ordered: pipeline.ordered,
    composed: pipeline.composed,
    composition: pipeline.composition,
    parity: {
      candidateEligibility,
      ranker,
      baselineDigest: digestIds(baselineOrder.orderedIds),
      platformDigest: digestIds(platformOrder),
    },
  }
}

function runCandidatePipeline(input: {
  nominations: readonly CandidateNomination[]
  adapterRejections?: readonly CandidateAdapterRejection[]
  context: RecommendationCandidateContext
  limit: number
  composition?: RecommendationSlateComposition
  rank: typeof scoreAndOrderCandidates
  rankerReasonCode:
    | typeof DETERMINISTIC_RANKER_VERSION
    | typeof HYBRID_DETERMINISTIC_RANKER_VERSION
}): CandidatePipelineResult {
  const adapterRejections = input.adapterRejections ?? []
  const union = unionAndCanonicalizeCandidates(input.nominations)
  const eligibility = evaluateCandidateEligibility(
    union.candidates,
    input.context,
  )
  const ordered = input.rank(eligibility.eligible)
  const composition = composeRecommendationSlate(
    ordered,
    input.context,
    input.limit,
    input.composition,
  )
  const evidence: CandidateStageEvidence[] = []

  input.nominations.forEach((nomination, ordinal) => {
    evidence.push(
      stageEvidence("nominated", ordinal, nomination, {
        reasonCodes: nomination.source.rejectionReason
          ? [nomination.source.rejectionReason]
          : [],
      }),
    )
  })
  union.canonicalizations.forEach((entry, ordinal) => {
    const nomination = input.nominations.find(
      (candidate) => candidate.nominationKey === entry.nominationKey,
    )
    evidence.push({
      ...stageEvidence("canonicalized", ordinal, nomination ?? null),
      candidateKey: entry.candidateKey,
      targetMediaId: entry.targetMediaId,
      reasonCodes: [entry.reasonCode],
    })
  })
  union.candidates.forEach((candidate, ordinal) => {
    evidence.push({
      ...emptyStageEvidence(
        "deduplicated",
        ordinal,
        candidate.candidateKey,
        candidate.targetMediaId,
      ),
      reasonCodes:
        candidate.deduplicationReasons.length > 0
          ? candidate.deduplicationReasons
          : ["canonical_unique"],
      sourceEvidence: candidate.sources,
    })
  })
  adapterRejections.forEach((rejection, ordinal) => {
    evidence.push({
      ...emptyStageEvidence(
        "rejected",
        ordinal,
        rejection.candidateKey,
        rejection.targetMediaId,
      ),
      sourceGenerator: rejection.generator,
      reasonCodes: [rejection.reasonCode],
    })
  })
  eligibility.rejected.forEach((rejection, index) => {
    evidence.push({
      ...emptyStageEvidence(
        "rejected",
        adapterRejections.length + index,
        rejection.candidate.candidateKey,
        rejection.candidate.targetMediaId,
      ),
      reasonCodes: rejection.reasonCodes,
      sourceEvidence: rejection.candidate.sources,
    })
  })
  composition.suppressions.forEach((suppression, index) => {
    evidence.push({
      ...emptyStageEvidence(
        "rejected",
        adapterRejections.length + eligibility.rejected.length + index,
        suppression.candidate.candidateKey,
        suppression.candidate.targetMediaId,
      ),
      deterministicScore: suppression.candidate.deterministicScore,
      reasonCodes: [...suppression.reasonCodes],
      sourceEvidence: suppression.candidate.sources,
    })
  })
  ordered.forEach((candidate, ordinal) => {
    const base = emptyStageEvidence(
      "scored",
      ordinal,
      candidate.candidateKey,
      candidate.targetMediaId,
    )
    evidence.push({
      ...base,
      normalizedScore: candidate.normalizedSemanticScore,
      rrfScore: candidate.rrfBenchmark,
      deterministicScore: candidate.deterministicScore,
      reasonCodes: [input.rankerReasonCode],
      sourceEvidence: candidate.sources,
    })
    evidence.push({
      ...base,
      stage: "ordered",
      finalPosition: candidate.orderedPosition,
      deterministicScore: candidate.deterministicScore,
      reasonCodes: ["deterministic_score_desc_target_media_id_asc"],
      sourceEvidence: candidate.sources,
    })
  })
  composition.composed.forEach((candidate, ordinal) => {
    const refilledAfterSuppression = composition.suppressions.some(
      (suppression) =>
        suppression.candidate.candidateKey === candidate.candidateKey,
    )
    evidence.push({
      ...emptyStageEvidence(
        "composed",
        ordinal,
        candidate.candidateKey,
        candidate.targetMediaId,
      ),
      finalPosition: candidate.composedPosition,
      deterministicScore: candidate.deterministicScore,
      reasonCodes: [
        "playable_localized_deduplicated",
        !refilledAfterSuppression &&
        candidate.orderedPosition === candidate.composedPosition
          ? "position_retained"
          : "refill_after_suppression",
      ],
      sourceEvidence: candidate.sources,
    })
  })

  return {
    evidence,
    eligibleTargetMediaIds: eligibility.eligible.map(
      (candidate) => candidate.targetMediaId,
    ),
    ordered,
    composed: composition.composed,
    composition,
  }
}

function legacySemanticOrder(
  nominations: readonly CandidateNomination[],
  context: RecommendationCandidateContext,
  limit: number,
) {
  const accepted = nominations
    .filter(
      (nomination) =>
        nominationEligibilityReasons(nomination, context).length === 0,
    )
    .sort(
      (left, right) =>
        right.source.score - left.source.score ||
        left.targetMediaId.localeCompare(right.targetMediaId) ||
        left.presentation.sceneIndex - right.presentation.sceneIndex,
    )
  const deduplicated = dedupeByVideoIdentity(
    accepted.map((nomination) => ({
      nomination,
      videoCoreId: nomination.canonicalIdentity.videoCoreId,
      videoTitle: nomination.canonicalIdentity.videoTitle,
      embeddingText: nomination.canonicalIdentity.embeddingText,
    })),
    MAX_CANDIDATE_NOMINATIONS,
  ).map((entry) => entry.nomination)
  return {
    eligibleIds: deduplicated.map((nomination) => nomination.targetMediaId),
    orderedIds: deduplicated
      .slice(0, Math.max(0, Math.min(6, Math.trunc(limit))))
      .map((nomination) => nomination.targetMediaId),
  }
}

function stageEvidence(
  stage: CandidatePlatformStage,
  ordinal: number,
  nomination: CandidateNomination | null,
  overrides: Partial<CandidateStageEvidence> = {},
): CandidateStageEvidence {
  return {
    ...emptyStageEvidence(
      stage,
      ordinal,
      nomination?.nominationKey ?? `${stage}:${ordinal}`,
      nomination?.targetMediaId ?? null,
    ),
    sourceGenerator: nomination?.source.generator ?? null,
    sourceRank: nomination?.source.rank ?? null,
    sourceScore: nomination?.source.score ?? null,
    sourceEvidence: nomination ? [nomination.source] : [],
    ...overrides,
  }
}

function emptyStageEvidence(
  stage: CandidatePlatformStage,
  ordinal: number,
  candidateKey: string,
  targetMediaId: string | null,
): CandidateStageEvidence {
  return {
    stage,
    ordinal,
    candidateKey,
    targetMediaId,
    sourceGenerator: null,
    sourceRank: null,
    sourceScore: null,
    normalizedScore: null,
    rrfScore: null,
    deterministicScore: null,
    finalPosition: null,
    reasonCodes: [],
    sourceEvidence: [],
  }
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function digestIds(ids: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(ids)).digest("hex")
}

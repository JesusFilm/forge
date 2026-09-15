import type { SceneRecommendation } from "@/services/scene-recommendations.service"
import { dedupeByVideoIdentity } from "@/services/video-dedup"
import {
  CANDIDATE_CONTEXT_VERSION,
  CANDIDATE_ELIGIBILITY_VERSION,
  CANDIDATE_UNION_VERSION,
  DETERMINISTIC_RANKER_VERSION,
  MAX_CANDIDATE_NOMINATIONS,
  MINIMAL_SLATE_VERSION,
  SEMANTIC_CANDIDATE_GENERATOR_VERSION,
  toBoundedCandidatePresentation,
  type CandidateNomination,
  type SemanticCandidatePoolItem,
} from "./candidate"
import type { RecommendationShortfallReason } from "./contracts"
import type {
  CandidatePlatformResult,
  CandidateStageEvidence,
  SemanticCandidatePlatformResult,
} from "./orchestration"

export type PreparedCandidate = Readonly<{
  candidate: SceneRecommendation
  sources: Array<{
    generator: string
    generatorVersion: string
    rank: number
    score: number
    evidence: Readonly<Record<string, string | number | boolean | null>>
    rejectionReason: string | null
  }>
  normalizedSemanticScore: number
  rrfBenchmark: number
  deterministicScore: number
}>

/**
 * Preserve the complete bounded semantic reserve, then use the remaining
 * platform capacity for profile nominations. Interleaving the selected source
 * slices keeps both generators visible to canonicalization without allowing a
 * full profile fanout to push the semantic refill reserve past the durable
 * 64-nomination contract.
 */
export function mergeBoundedHybridNominations(
  semantic: readonly CandidateNomination[],
  profile: readonly CandidateNomination[],
): CandidateNomination[] {
  const boundedSemantic = semantic.slice(0, MAX_CANDIDATE_NOMINATIONS)
  const boundedProfile = profile.slice(
    0,
    Math.max(0, MAX_CANDIDATE_NOMINATIONS - boundedSemantic.length),
  )
  const merged: CandidateNomination[] = []
  const sourceLength = Math.max(boundedSemantic.length, boundedProfile.length)
  for (let index = 0; index < sourceLength; index += 1) {
    const semanticNomination = boundedSemantic[index]
    if (semanticNomination) merged.push(semanticNomination)
    const profileNomination = boundedProfile[index]
    if (profileNomination) merged.push(profileNomination)
  }
  return merged
}

export function preparedCandidatesFromPlatform(
  platform: CandidatePlatformResult,
): PreparedCandidate[] {
  return platform.composed.map((candidate) => ({
    candidate: {
      videoId: candidate.targetMediaId,
      videoSlug: candidate.presentation.videoSlug,
      videoTitle: candidate.presentation.videoTitle,
      imageUrl: candidate.presentation.imageUrl,
      sceneIndex: candidate.presentation.sceneIndex,
      description: candidate.presentation.description,
      startSeconds: candidate.presentation.startSeconds,
      endSeconds: candidate.presentation.endSeconds,
      durationSeconds: candidate.presentation.durationSeconds ?? null,
      similarity: compatibilitySimilarity(candidate.sources),
      themes: candidate.presentation.themes,
      demographics: candidate.presentation.demographics,
      spiritualContext: candidate.presentation.spiritualContext,
      playbackId: candidate.presentation.playbackId,
    },
    sources: candidate.sources.map((source) => ({ ...source })),
    normalizedSemanticScore: candidate.normalizedSemanticScore,
    rrfBenchmark: candidate.rrfBenchmark,
    deterministicScore: candidate.deterministicScore,
  }))
}

export function selectedCandidateGenerator(
  sources: PreparedCandidate["sources"],
): "semantic" | "multi-interest-profile" {
  return sources.some((source) => source.generator === "multi-interest-profile")
    ? "multi-interest-profile"
    : "semantic"
}

export function recommendationShortfallReason(input: {
  requestedCount: number
  composedCount: number
  reason: string | null
  nominatedCount: number
  rejectedCount: number
}): RecommendationShortfallReason | null {
  if (input.composedCount >= input.requestedCount) return null
  if (input.reason === "seed_embedding_unavailable") {
    return "seed_material_unavailable"
  }
  if (input.reason?.includes("timeout")) return "deadline_exhausted"
  if (input.rejectedCount > 0 && input.nominatedCount >= input.requestedCount) {
    return "eligibility_exhausted"
  }
  return "insufficient_candidates"
}

export function lastKnownGoodSemanticCandidates(
  candidates: readonly SemanticCandidatePoolItem[],
  context: { locale: string; audioLanguageSlug: string },
  limit: number,
  currentVideoId?: string,
): PreparedCandidate[] {
  const eligible = candidates
    .filter(
      (candidate) =>
        candidate.videoId !== currentVideoId &&
        candidate.sourceRejectionReason == null &&
        (candidate.locale ?? context.locale) === context.locale &&
        (candidate.audioLanguageSlug ?? context.audioLanguageSlug) ===
          context.audioLanguageSlug &&
        (candidate.watchPlayable ?? true) &&
        (candidate.localePublished ?? true) &&
        Boolean(candidate.playbackId.trim()) &&
        Boolean(candidate.imageUrl?.trim()),
    )
    .sort(
      (left, right) =>
        right.similarity - left.similarity ||
        left.videoId.localeCompare(right.videoId) ||
        left.sceneIndex - right.sceneIndex,
    )
  return dedupeByVideoIdentity(eligible, limit).map((candidate, index) => {
    const presentation = toBoundedCandidatePresentation(candidate, context)
    return {
      candidate: {
        videoId: candidate.videoId,
        videoSlug: presentation.videoSlug,
        videoTitle: presentation.videoTitle,
        imageUrl: presentation.imageUrl,
        sceneIndex: presentation.sceneIndex,
        description: presentation.description,
        startSeconds: presentation.startSeconds,
        endSeconds: presentation.endSeconds,
        durationSeconds: presentation.durationSeconds ?? null,
        similarity: candidate.similarity,
        themes: presentation.themes,
        demographics: presentation.demographics,
        spiritualContext: presentation.spiritualContext,
        playbackId: presentation.playbackId,
      },
      sources: [
        {
          generator: "semantic",
          generatorVersion: SEMANTIC_CANDIDATE_GENERATOR_VERSION,
          rank: index + 1,
          score: candidate.similarity,
          evidence: {
            sceneIndex: candidate.sceneIndex,
            similarity: candidate.similarity,
          },
          rejectionReason: null,
        },
      ],
      normalizedSemanticScore: 1,
      rrfBenchmark: Math.round((1 / (61 + index)) * 1_000_000) / 1_000_000,
      deterministicScore: 1,
    }
  })
}

export function annotateComposedEvidence(
  platform: CandidatePlatformResult,
  reasonCode: string,
): CandidatePlatformResult {
  return {
    ...platform,
    evidence: platform.evidence.map((entry) =>
      entry.stage === "composed"
        ? { ...entry, reasonCodes: [...entry.reasonCodes, reasonCode] }
        : entry,
    ),
  }
}

export function appendSourceFailureEvidence(
  platform: CandidatePlatformResult,
  reasonCode: string,
  sourceGenerator = "semantic",
): CandidatePlatformResult {
  const rejection: CandidateStageEvidence = {
    stage: "rejected",
    ordinal: platform.counts.rejected,
    candidateKey: `${sourceGenerator}:${reasonCode}`.slice(0, 191),
    targetMediaId: null,
    sourceGenerator,
    sourceRank: null,
    sourceScore: null,
    normalizedScore: null,
    rrfScore: null,
    deterministicScore: null,
    finalPosition: null,
    reasonCodes: [reasonCode],
    sourceEvidence: [],
  }
  return {
    ...platform,
    counts: { ...platform.counts, rejected: platform.counts.rejected + 1 },
    evidence: [...platform.evidence, rejection],
    parity: {
      candidateEligibility: "not_evaluated",
      ranker: "not_evaluated",
      baselineDigest: "",
      platformDigest: "",
    },
  }
}

export function failedCandidatePlatform(
  reasonCode: string,
): SemanticCandidatePlatformResult {
  return {
    stageOrder: [
      "nominated",
      "canonicalized",
      "deduplicated",
      "rejected",
      "scored",
      "ordered",
      "composed",
    ],
    versions: {
      context: CANDIDATE_CONTEXT_VERSION,
      generator: SEMANTIC_CANDIDATE_GENERATOR_VERSION,
      union: CANDIDATE_UNION_VERSION,
      eligibility: CANDIDATE_ELIGIBILITY_VERSION,
      ranker: DETERMINISTIC_RANKER_VERSION,
      composer: MINIMAL_SLATE_VERSION,
    },
    counts: {
      nominated: 0,
      canonicalized: 0,
      deduplicated: 0,
      rejected: 1,
      scored: 0,
      ordered: 0,
      composed: 0,
    },
    evidence: [
      {
        stage: "rejected",
        ordinal: 0,
        candidateKey: "candidate-platform",
        targetMediaId: null,
        sourceGenerator: "semantic",
        sourceRank: null,
        sourceScore: null,
        normalizedScore: null,
        rrfScore: null,
        deterministicScore: null,
        finalPosition: null,
        reasonCodes: [reasonCode],
        sourceEvidence: [],
      },
    ],
    ordered: [],
    composed: [],
    composition: { composed: [], suppressions: [] },
    parity: {
      candidateEligibility: "not_evaluated",
      ranker: "not_evaluated",
      baselineDigest: "",
      platformDigest: "",
    },
  }
}

export function nullableDigest(value: string): string | null {
  return /^[a-f0-9]{64}$/.test(value) ? value : null
}

function compatibilitySimilarity(
  sources: PreparedCandidate["sources"],
): number {
  const accepted = sources.filter((source) => source.rejectionReason == null)
  return (
    accepted.find((source) => source.generator === "semantic")?.score ??
    accepted[0]?.score ??
    0
  )
}

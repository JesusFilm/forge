import type { SceneRecommendation } from "@/services/scene-recommendations.service"

export const SEMANTIC_CANDIDATE_GENERATOR_VERSION =
  "semantic-transcript-candidate-v1" as const
export const CANDIDATE_CONTEXT_VERSION = "recommendation-context-v1" as const
export const CANDIDATE_UNION_VERSION = "canonical-video-union-v1" as const
export const CANDIDATE_ELIGIBILITY_VERSION = "watch-playable-locale-v1" as const
export const DETERMINISTIC_RANKER_VERSION =
  "semantic-deterministic-ranker-v1" as const
export const MINIMAL_SLATE_VERSION = "minimal-playable-slate-v1" as const
export const HYBRID_DETERMINISTIC_RANKER_VERSION =
  "source-rank-hybrid-ranker-v1" as const
export const HYBRID_CANDIDATE_GENERATOR_SET_VERSION =
  "semantic-profile-hybrid-generators-v1" as const
export const HYBRID_SLATE_COMPOSER_VERSION =
  "recent-video-refill-composer-v1" as const

export const MAX_CANDIDATE_NOMINATIONS = 64
export const MAX_CANDIDATE_SOURCE_CONTRIBUTIONS = 16

export type RecommendationCandidatePurpose =
  | "watch"
  | "find_to_share"
  | "course_build"
  | "experience_generation"

export type RecommendationCandidateContext = Readonly<{
  surface: "watch-below-player-v1"
  purpose: RecommendationCandidatePurpose
  locale: string
  audioLanguageSlug: string
}>

/**
 * Bounded output from semantic retrieval. The compatibility DTO fields stay
 * intact while canonical identity and prevalidated watchability facts remain
 * internal to the permanent candidate seam.
 */
export type SemanticCandidatePoolItem = SceneRecommendation &
  Readonly<{
    videoCoreId?: string | null
    embeddingText?: string | null
    locale?: string
    audioLanguageSlug?: string
    watchPlayable?: boolean
    localePublished?: boolean
    sourceRejectionReason?: string | null
  }>

export type CandidateSourceEvidence = Readonly<{
  generator: string
  generatorVersion: string
  rank: number
  score: number
  evidence: Readonly<Record<string, string | number | boolean | null>>
  rejectionReason: string | null
}>

export type CandidatePresentation = Readonly<{
  videoSlug: string
  videoTitle: string
  imageUrl: string | null
  sceneIndex: number
  description: string
  startSeconds: number
  endSeconds: number | null
  durationSeconds?: number | null
  themes: string[]
  demographics: string[]
  spiritualContext: string[]
  playbackId: string
  locale: string
  audioLanguageSlug: string
  watchPlayable: boolean
  localePublished: boolean
}>

export type CandidateNomination = Readonly<{
  nominationKey: string
  targetMediaId: string
  canonicalIdentity: Readonly<{
    videoId: string
    videoCoreId: string | null
    videoTitle: string | null
    embeddingText: string | null
  }>
  presentation: CandidatePresentation
  action: Readonly<{ kind: "scene_start"; startSeconds: number }>
  source: CandidateSourceEvidence
}>

export type CandidateSourceRejection = Readonly<{
  candidateKey: string
  targetMediaId: string | null
  generator: "semantic"
  reasonCode: string
}>

export type SemanticCandidateAdapterResult = Readonly<{
  nominations: CandidateNomination[]
  rejections: CandidateSourceRejection[]
}>

export function adaptSemanticCandidates(
  candidates: readonly SemanticCandidatePoolItem[],
  context: RecommendationCandidateContext,
): SemanticCandidateAdapterResult {
  if (context.purpose !== "watch") {
    return {
      nominations: [],
      rejections: [
        {
          candidateKey: "semantic:unsupported-purpose",
          targetMediaId: null,
          generator: "semantic",
          reasonCode: "unsupported_purpose",
        },
      ],
    }
  }

  const bounded = candidates.slice(0, MAX_CANDIDATE_NOMINATIONS)
  return {
    nominations: bounded.map((candidate, index) => {
      const sourceRank = index + 1
      const presentation = toBoundedCandidatePresentation(candidate, context)
      return {
        nominationKey: `semantic:${sourceRank}:${candidate.videoId}`.slice(
          0,
          191,
        ),
        targetMediaId: candidate.videoId,
        canonicalIdentity: {
          videoId: candidate.videoId,
          videoCoreId: candidate.videoCoreId ?? null,
          videoTitle: candidate.videoTitle || null,
          embeddingText: candidate.embeddingText ?? null,
        },
        presentation,
        action: {
          kind: "scene_start" as const,
          startSeconds: candidate.startSeconds,
        },
        source: {
          generator: "semantic" as const,
          generatorVersion: SEMANTIC_CANDIDATE_GENERATOR_VERSION,
          rank: sourceRank,
          score: boundedScore(candidate.similarity),
          evidence: {
            sceneIndex: candidate.sceneIndex,
            similarity: boundedScore(candidate.similarity),
          },
          rejectionReason: candidate.sourceRejectionReason ?? null,
        },
      }
    }),
    rejections: [],
  }
}

export function toBoundedCandidatePresentation(
  candidate: SemanticCandidatePoolItem,
  context: Pick<RecommendationCandidateContext, "locale" | "audioLanguageSlug">,
): CandidatePresentation {
  return {
    videoSlug: boundedUtf8String(candidate.videoSlug, 191),
    videoTitle: boundedUtf8String(candidate.videoTitle, 512),
    imageUrl:
      candidate.imageUrl == null
        ? null
        : boundedUtf8String(candidate.imageUrl, 2_048),
    sceneIndex: Math.max(0, Math.min(2_147_483_647, candidate.sceneIndex)),
    description: boundedUtf8String(candidate.description, 1_000),
    startSeconds: boundedSeconds(candidate.startSeconds),
    endSeconds:
      candidate.endSeconds == null
        ? null
        : boundedSeconds(candidate.endSeconds),
    durationSeconds:
      candidate.durationSeconds == null
        ? null
        : boundedSeconds(candidate.durationSeconds),
    themes: boundedStringArray(candidate.themes),
    demographics: boundedStringArray(candidate.demographics),
    spiritualContext: boundedStringArray(candidate.spiritualContext),
    playbackId: boundedUtf8String(candidate.playbackId, 512),
    locale: boundedUtf8String(candidate.locale ?? context.locale, 32),
    audioLanguageSlug: boundedUtf8String(
      candidate.audioLanguageSlug ?? context.audioLanguageSlug,
      64,
    ),
    watchPlayable: candidate.watchPlayable ?? true,
    localePublished: candidate.localePublished ?? true,
  }
}

function boundedUtf8String(value: string, maximumBytes: number): string {
  let bounded = value.slice(0, maximumBytes)
  while (Buffer.byteLength(bounded) > maximumBytes) {
    bounded = bounded.slice(0, -1)
  }
  return bounded
}

function boundedStringArray(values: readonly string[]): string[] {
  return values.slice(0, 16).map((value) => boundedUtf8String(value, 64))
}

export function boundedSeconds(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(86_400, value))
}

export function boundedScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(-1, Math.min(1, value))
}

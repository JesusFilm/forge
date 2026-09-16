import { Prisma, type PrismaClient } from "@prisma/client"
import { createVideoIdentityDuplicateReasonResolver } from "@/services/video-dedup"
import type { VideoDedupKeys } from "@/services/video-dedup"
import {
  MAX_CANDIDATE_NOMINATIONS,
  toBoundedCandidatePresentation,
  type CandidateNomination,
} from "./candidate"
import { CuratedPoolsService } from "./curated-pools.service"
import type { CuratedRecommendationCandidate } from "./curated-pools.types"
import { runRecommendationRetrievalQuery } from "./delivery-runtime"

export const SEEDED_CURATED_FALLBACK_VERSION =
  "seeded-curated-empty-fallback-v1"

type ExcludedVideo = VideoDedupKeys & { videoId: string }
type FallbackInput = {
  seedMediaId: string
  locale: string
  audioLanguageSlug: string
  excludedMediaIds: readonly string[]
  deadlineAt: number
}

/** Approved inventory only; no fallback across audio/locale or catalog scan. */
export async function retrieveCuratedFallback(
  prisma: PrismaClient,
  input: FallbackInput,
): Promise<CandidateNomination[]> {
  const excludedIds = [
    ...new Set([input.seedMediaId, ...input.excludedMediaIds]),
  ].slice(0, MAX_CANDIDATE_NOMINATIONS)
  const [pool, excluded] = await Promise.all([
    new CuratedPoolsService({ prisma }).getCandidates({
      locale: input.locale,
      audioLanguageSlug: input.audioLanguageSlug,
      limit: MAX_CANDIDATE_NOMINATIONS,
      deadlineAt: input.deadlineAt,
    }),
    runRecommendationRetrievalQuery(prisma, input.deadlineAt, (db) =>
      db.$queryRaw<ExcludedVideo[]>(Prisma.sql`
        SELECT video.id AS "videoId", video.core_id AS "videoCoreId",
          localized.title AS "videoTitle"
        FROM video
        LEFT JOIN video_locale localized
          ON localized.video_id = video.id AND localized.locale = ${input.locale}
        WHERE video.id IN (${Prisma.join(excludedIds)})
      `),
    ),
  ])
  // A missing embedding may fall back; an unknown seed must not create a row.
  if (!excluded.some((video) => video.videoId === input.seedMediaId)) return []
  return curatedFallbackNominations(pool.items, excludedIds, excluded)
}

export function curatedFallbackNominations(
  items: readonly CuratedRecommendationCandidate[],
  excludedIds: readonly string[],
  excluded: readonly ExcludedVideo[],
): CandidateNomination[] {
  const ids = new Set(excludedIds)
  const duplicateReason = createVideoIdentityDuplicateReasonResolver()
  return items.slice(0, MAX_CANDIDATE_NOMINATIONS).map((item, index) => ({
    nominationKey: `curated:${index + 1}:${item.videoId}`.slice(0, 191),
    targetMediaId: item.videoId,
    canonicalIdentity: {
      videoId: item.videoId,
      videoCoreId: item.videoCoreId,
      videoTitle: item.videoTitle,
      embeddingText: item.embeddingText,
    },
    presentation: toBoundedCandidatePresentation(
      // Legacy scene fields are neutral placeholders, never semantic evidence.
      { ...item, sceneIndex: 0, similarity: 0, startSeconds: 0 },
      { locale: item.locale, audioLanguageSlug: item.audioLanguageSlug },
    ),
    action: { kind: "scene_start", startSeconds: 0 },
    source: {
      generator: "curated",
      generatorVersion: SEEDED_CURATED_FALLBACK_VERSION,
      rank: index + 1,
      score: 0,
      evidence: {
        poolVersion: item.poolVersion,
        poolKey: item.poolKey,
        editorialRank: item.editorialRank,
        similarity: null,
      },
      rejectionReason:
        ids.has(item.videoId) ||
        excluded.some((video) => duplicateReason(item, video))
          ? "current_or_recent_video"
          : null,
    },
  }))
}

/**
 * Transcript-backed recommendations orchestrator for the legacy
 * `sceneRecommendations` API shape.
 *
 * Shared service called by both the REST handler at
 * `/api/scene-embedding/recommendations` and the public Pothos query
 * `sceneRecommendations`. The API name remains for cms/client parity, but
 * feat-192 routes the backing signal through enriched transcript chunks.
 *
 * Two modes:
 *   - **Per-chunk** (sceneIndex provided OR seed video has a single
 *     transcript chunk): run ONE similarity query against the seed embedding,
 *     overfetch × `OVERFETCH_FACTOR`, dedup, slice to `limit`.
 *   - **Per-video** (sceneIndex omitted, seed video has ≥2 transcript chunks):
 *     run one similarity query per chunk, accumulate
 *     best-similarity-per-candidate into a Map, sort, dedup, slice.
 *
 * `VideoNotFoundError` is thrown when the seed video cannot be resolved
 * or has no embedded transcript chunks in the requested locale. REST maps this to
 * 404. GraphQL soft-swallows to `[]` (matches cms's resolver).
 */

import type { PrismaClient } from "@prisma/client"
import { dedupeByVideoIdentity } from "./video-dedup"
import {
  fetchInputEmbeddings,
  getRelatedVideoIds,
  queryScenesSimilar,
  resolveSlugToVideoId,
  type SceneRecommendationSqlRow,
} from "./scene-recommendations-retriever"

export const DEFAULT_LIMIT = 10
export const MAX_LIMIT = 50
export const OVERFETCH_FACTOR = 3

export type SceneRecommendation = {
  /** admin cuid (was Int in cms — see plan §2 technical decision 2). */
  videoId: string
  videoSlug: string
  videoTitle: string
  imageUrl: string | null
  sceneIndex: number
  description: string
  startSeconds: number
  endSeconds: number | null
  similarity: number
  themes: string[]
  demographics: string[]
  spiritualContext: string[]
  playbackId: string
}

export type RecommendationParams = {
  videoId?: string
  slug?: string
  locale: string
  sceneIndex?: number
  limit?: number
}

export class VideoNotFoundError extends Error {
  constructor(videoId: string, sceneIndex?: number) {
    const msg =
      sceneIndex !== undefined
        ? `No embedding found for video ${videoId} scene ${sceneIndex}`
        : `No embeddings found for video ${videoId}`
    super(msg)
    this.name = "VideoNotFoundError"
  }
}

function clampLimit(raw?: number): number {
  const value = raw ?? DEFAULT_LIMIT
  if (!Number.isFinite(value)) return DEFAULT_LIMIT
  return Math.min(Math.max(1, Math.trunc(value)), MAX_LIMIT)
}

function mapRow(row: SceneRecommendationSqlRow): SceneRecommendation {
  return {
    videoId: row.video_id,
    videoSlug: row.video_slug ?? "",
    videoTitle: row.video_title ?? "",
    imageUrl: null,
    sceneIndex: row.scene_index,
    description: row.description,
    startSeconds: row.start_seconds,
    endSeconds: row.end_seconds,
    similarity: row.similarity,
    themes: row.themes,
    demographics: row.demographics,
    spiritualContext: row.spiritual_context,
    playbackId: row.playback_id,
  }
}

export class SceneRecommendationsService {
  constructor(private readonly deps: { prisma: PrismaClient }) {}

  async getRecommendations(
    params: RecommendationParams,
  ): Promise<SceneRecommendation[]> {
    const { prisma } = this.deps
    const { sceneIndex } = params
    const locale = params.locale?.trim() ?? ""
    if (locale.length === 0) {
      throw new Error("locale is required")
    }
    const limit = clampLimit(params.limit)

    // Resolve seed videoId from either direct arg or slug lookup.
    let videoId = params.videoId?.trim() || undefined
    const slug = params.slug?.trim() || undefined
    if (videoId == null && slug) {
      videoId = (await resolveSlugToVideoId(prisma, slug)) ?? undefined
      if (videoId == null) {
        throw new VideoNotFoundError(`slug:${slug}`)
      }
    }
    if (videoId == null) {
      throw new Error("Either videoId or slug must be provided")
    }

    // Fetch input embeddings. Empty → VideoNotFoundError.
    const embeddings = await fetchInputEmbeddings(
      prisma,
      videoId,
      locale,
      sceneIndex,
    )
    if (embeddings.length === 0) {
      throw new VideoNotFoundError(videoId, sceneIndex)
    }

    const excludeIds = await getRelatedVideoIds(prisma, videoId)

    // Single-embedding path — one query, dedup, slice.
    const [firstEmbedding] = embeddings
    if (embeddings.length === 1 && firstEmbedding) {
      const candidates = await queryScenesSimilar(
        prisma,
        firstEmbedding.embedding,
        locale,
        excludeIds,
        limit * OVERFETCH_FACTOR,
      )
      return dedupeByVideoIdentity(asDedupeInput(candidates), limit).map(
        (entry) => mapRow(entry.row),
      )
    }

    // Per-video path — query per scene, keep best similarity per candidate.
    const bestByVideo = new Map<string, SceneRecommendationSqlRow>()
    const perSceneLimit = Math.min(limit * OVERFETCH_FACTOR, MAX_LIMIT)

    for (const emb of embeddings) {
      const candidates = await queryScenesSimilar(
        prisma,
        emb.embedding,
        locale,
        excludeIds,
        perSceneLimit,
      )
      for (const candidate of candidates) {
        const existing = bestByVideo.get(candidate.video_id)
        if (!existing || candidate.similarity > existing.similarity) {
          bestByVideo.set(candidate.video_id, candidate)
        }
      }
    }

    const sorted = [...bestByVideo.values()].sort(
      (a, b) => b.similarity - a.similarity,
    )

    return dedupeByVideoIdentity(asDedupeInput(sorted), limit).map((entry) =>
      mapRow(entry.row),
    )
  }
}

/**
 * Wrap each SQL row into the structural `VideoDedupKeys` shape the shared
 * primitive expects. The dedup key fields alias row columns; the original
 * row sits under `row` so the caller can project back to `SceneRecommendation`.
 */
function asDedupeInput(rows: SceneRecommendationSqlRow[]): Array<{
  row: SceneRecommendationSqlRow
  videoCoreId: string | null
  videoTitle: string | null
  embeddingText: string
}> {
  return rows.map((row) => ({
    row,
    videoCoreId: row.video_core_id,
    videoTitle: row.video_title,
    embeddingText: row.embedding_text,
  }))
}

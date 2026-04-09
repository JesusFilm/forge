import type { Core } from "@strapi/strapi"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KnexInstance = any

export type RecommendationParams = {
  videoId?: number
  slug?: string
  locale: string
  sceneIndex?: number
  limit?: number
}

export type SceneRecommendation = {
  videoId: number
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

type EmbeddingRow = {
  embedding: string
  scene_index: number
}

type RecommendationRow = {
  video_id: number
  video_slug: string
  video_title: string
  image_url: string | null
  scene_index: number
  description: string
  start_seconds: number
  end_seconds: number | null
  similarity: number
  themes: string[]
  demographics: string[]
  spiritual_context: string[]
  playback_id: string
}

/**
 * Per-scene similarity query: find the most similar scenes from other videos
 * that have a variant in the requested locale.
 *
 * Uses DISTINCT ON (se.video_id) to return at most one scene per candidate
 * video, ordered by cosine similarity (best match wins).
 *
 * Join chain for locale filtering (Strapi v5 link tables):
 *   scene_embeddings.video_id
 *     → video_variants_video_lnk.video_id
 *     → video_variants (published_at IS NOT NULL)
 *     → video_variants_language_lnk.video_variant_id
 *     → languages.bcp_47 = $locale
 */
const SIMILARITY_SQL = `
  SELECT DISTINCT ON (se.video_id)
    se.video_id,
    v.slug AS video_slug,
    v.title AS video_title,
    COALESCE(vi.mobile_cinematic_high, vi.url) AS image_url,
    se.scene_index,
    se.description,
    se.start_seconds,
    se.end_seconds,
    se.themes,
    se.demographics,
    se.spiritual_context,
    se.playback_id,
    1 - (se.embedding <=> ?::vector) AS similarity
  FROM scene_embeddings se
  JOIN videos v ON v.id = se.video_id
  LEFT JOIN LATERAL (
    SELECT vi2.mobile_cinematic_high, vi2.url
    FROM video_images_video_lnk lnk
    JOIN video_images vi2 ON vi2.id = lnk.video_image_id
      AND vi2.published_at IS NOT NULL
    WHERE lnk.video_id = se.video_id
    ORDER BY lnk.video_image_ord
    LIMIT 1
  ) vi ON true
  JOIN video_variants_video_lnk vvl ON vvl.video_id = se.video_id
  JOIN video_variants vv ON vv.id = vvl.video_variant_id
    AND vv.published_at IS NOT NULL
  JOIN video_variants_language_lnk vll ON vll.video_variant_id = vv.id
  JOIN languages l ON l.id = vll.language_id
    AND l.bcp_47 = ?
  WHERE se.video_id != ALL(?::int[])
  ORDER BY se.video_id, se.embedding <=> ?::vector
`

/**
 * Wraps the DISTINCT ON query in a subquery so we can ORDER BY similarity
 * descending and apply LIMIT.
 */
const RECOMMENDATIONS_SQL = `
  SELECT * FROM (${SIMILARITY_SQL}) sub
  ORDER BY sub.similarity DESC
  LIMIT ?
`

export class VideoNotFoundError extends Error {
  constructor(videoId: number, sceneIndex?: number) {
    const msg =
      sceneIndex !== undefined
        ? `No embedding found for video ${videoId} scene ${sceneIndex}`
        : `No embeddings found for video ${videoId}`
    super(msg)
    this.name = "VideoNotFoundError"
  }
}

/**
 * Resolves a video slug to its numeric Strapi row ID.
 * Returns null if the slug does not match a published video.
 */
async function resolveSlugToId(
  knex: KnexInstance,
  slug: string,
): Promise<number | null> {
  const result: { rows: { id: number }[] } = await knex.raw(
    "SELECT id FROM videos WHERE slug = ? AND published_at IS NOT NULL LIMIT 1",
    [slug],
  )
  return result.rows[0]?.id ?? null
}

export async function getRecommendations(
  strapi: Core.Strapi,
  params: RecommendationParams,
): Promise<SceneRecommendation[]> {
  const MAX_LIMIT = 50
  const { locale, sceneIndex } = params
  const limit = Math.min(Math.max(1, params.limit ?? 10), MAX_LIMIT)
  const knex: KnexInstance = strapi.db.connection

  // Resolve videoId from slug if needed
  let videoId = params.videoId
  if (videoId == null && params.slug) {
    videoId = (await resolveSlugToId(knex, params.slug)) ?? undefined
    if (videoId == null) {
      throw new VideoNotFoundError(-1)
    }
  }
  if (videoId == null) {
    throw new Error("Either videoId or slug must be provided")
  }

  // Fetch input embedding(s)
  const embeddings = await fetchInputEmbeddings(knex, videoId, sceneIndex)
  if (embeddings.length === 0) {
    throw new VideoNotFoundError(videoId, sceneIndex)
  }

  // Build exclusion list: self + children + parent (avoid recommending
  // the same content in different cuts, e.g. JESUS film and its 61 segments)
  const excludeIds = await getRelatedVideoIds(knex, videoId)

  if (embeddings.length === 1) {
    // Per-scene mode (or single-scene video): one query
    return querySimilar(
      knex,
      embeddings[0]!.embedding,
      locale,
      excludeIds,
      limit,
    )
  }

  // Per-video mode: query each scene, merge by best similarity per candidate
  return queryPerVideo(knex, embeddings, locale, excludeIds, limit)
}

/**
 * Returns an array of video IDs to exclude from recommendations:
 * the input video itself, its children, and its parent (if any).
 * This prevents recommending the same content in different cuts
 * (e.g. JESUS film has 61 child segments that are clips from it).
 */
async function getRelatedVideoIds(
  knex: KnexInstance,
  videoId: number,
): Promise<number[]> {
  const result: { rows: { id: number }[] } = await knex.raw(
    `
    SELECT ?::int AS id
    UNION
    SELECT inv_video_id AS id FROM videos_children_lnk WHERE video_id = ?
    UNION
    SELECT video_id AS id FROM videos_children_lnk WHERE inv_video_id = ?
    `,
    [videoId, videoId, videoId],
  )
  return result.rows.map((r) => r.id)
}

async function fetchInputEmbeddings(
  knex: KnexInstance,
  videoId: number,
  sceneIndex?: number,
): Promise<EmbeddingRow[]> {
  if (sceneIndex !== undefined) {
    const result: { rows: EmbeddingRow[] } = await knex.raw(
      "SELECT embedding::text, scene_index FROM scene_embeddings WHERE video_id = ? AND scene_index = ?",
      [videoId, sceneIndex],
    )
    return result.rows
  }

  const result: { rows: EmbeddingRow[] } = await knex.raw(
    "SELECT embedding::text, scene_index FROM scene_embeddings WHERE video_id = ? ORDER BY scene_index",
    [videoId],
  )
  return result.rows
}

async function querySimilar(
  knex: KnexInstance,
  embeddingText: string,
  locale: string,
  excludeIds: number[],
  limit: number,
): Promise<SceneRecommendation[]> {
  const result: { rows: RecommendationRow[] } = await knex.raw(
    RECOMMENDATIONS_SQL,
    [embeddingText, locale, excludeIds, embeddingText, limit],
  )
  return result.rows.map(mapRow)
}

async function queryPerVideo(
  knex: KnexInstance,
  embeddings: EmbeddingRow[],
  locale: string,
  excludeIds: number[],
  limit: number,
): Promise<SceneRecommendation[]> {
  // Query each scene independently, collecting best match per candidate video
  const bestByVideo = new Map<number, SceneRecommendation>()

  // Fetch extra candidates per scene so the merge step has a better chance
  // of capturing the true global top-N after cross-scene deduplication.
  const perSceneLimit = Math.min(limit * 3, 50)

  for (const emb of embeddings) {
    const candidates = await querySimilar(
      knex,
      emb.embedding,
      locale,
      excludeIds,
      perSceneLimit,
    )
    for (const candidate of candidates) {
      const existing = bestByVideo.get(candidate.videoId)
      if (!existing || candidate.similarity > existing.similarity) {
        bestByVideo.set(candidate.videoId, candidate)
      }
    }
  }

  // Sort by best similarity and take top N
  return [...bestByVideo.values()]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
}

function mapRow(row: RecommendationRow): SceneRecommendation {
  return {
    videoId: row.video_id,
    videoSlug: row.video_slug ?? "",
    videoTitle: row.video_title ?? "",
    imageUrl: row.image_url ?? null,
    sceneIndex: row.scene_index,
    description: row.description,
    startSeconds: row.start_seconds,
    endSeconds: row.end_seconds,
    similarity: Number(row.similarity),
    themes: row.themes ?? [],
    demographics: row.demographics ?? [],
    spiritualContext: row.spiritual_context ?? [],
    playbackId: row.playback_id,
  }
}

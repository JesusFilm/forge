import type { Core } from "@strapi/strapi"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KnexInstance = any

export type RecommendationParams = {
  videoId: number
  locale: string
  sceneIndex?: number
  limit?: number
}

export type SceneRecommendation = {
  videoId: number
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

export async function getRecommendations(
  strapi: Core.Strapi,
  params: RecommendationParams,
): Promise<SceneRecommendation[]> {
  const MAX_LIMIT = 50
  const { videoId, locale, sceneIndex } = params
  const limit = Math.min(Math.max(1, params.limit ?? 10), MAX_LIMIT)
  const knex: KnexInstance = strapi.db.connection

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

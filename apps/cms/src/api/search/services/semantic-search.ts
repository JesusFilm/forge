// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KnexInstance = any

export type SemanticSearchParams = {
  queryEmbedding: string // pgvector text format "[0.1,0.2,...]"
  locale: string
  limit: number
}

export type SemanticResult = {
  videoId: number
  videoSlug: string
  videoTitle: string
  videoCoreId: string | null
  imageUrl: string | null
  sceneIndex: number
  description: string
  startSeconds: number
  playbackId: string
  similarity: number
  embeddingText: string
}

type SemanticRow = {
  video_id: number
  video_slug: string
  video_title: string
  video_core_id: string | null
  image_url: string | null
  scene_index: number
  description: string
  start_seconds: number
  playback_id: string
  similarity: number
  embedding_text: string
}

/**
 * Per-query semantic similarity: find the most similar scenes from all videos
 * that have a variant in the requested locale.
 *
 * Uses DISTINCT ON (se.video_id) to return at most one scene per candidate
 * video, ordered by cosine similarity (best match wins).
 *
 * Adapted from recommender.ts SIMILARITY_SQL with two differences:
 * 1. No WHERE se.video_id != ALL(...) exclusion (search has no "current video")
 * 2. The embedding comes from the user's query, not from another scene
 *
 * Join chain for locale filtering (Strapi v5 link tables):
 *   scene_embeddings.video_id
 *     → video_variants_video_lnk.video_id
 *     → video_variants (published_at IS NOT NULL)
 *     → video_variants_language_lnk.video_variant_id
 *     → languages.bcp_47 = $locale
 */
const SEMANTIC_SQL = `
  SELECT DISTINCT ON (se.video_id)
    se.video_id,
    v.slug AS video_slug,
    v.title AS video_title,
    v.core_id AS video_core_id,
    COALESCE(vi.mobile_cinematic_high, vi.url) AS image_url,
    se.scene_index,
    se.description,
    se.start_seconds,
    se.playback_id,
    1 - (se.embedding <=> ?::vector) AS similarity,
    se.embedding::text AS embedding_text
  FROM scene_embeddings se
  JOIN videos v ON v.id = se.video_id
    AND v.published_at IS NOT NULL
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
  ORDER BY se.video_id, se.embedding <=> ?::vector
`

/**
 * Wraps the DISTINCT ON query in a subquery so we can ORDER BY similarity
 * descending and apply LIMIT.
 */
const SEMANTIC_RANKED_SQL = `
  SELECT * FROM (${SEMANTIC_SQL}) sub
  ORDER BY sub.similarity DESC
  LIMIT ?
`

function mapRow(row: SemanticRow): SemanticResult {
  return {
    videoId: row.video_id,
    videoSlug: row.video_slug ?? "",
    videoTitle: row.video_title ?? "",
    videoCoreId: row.video_core_id ?? null,
    imageUrl: row.image_url ?? null,
    sceneIndex: row.scene_index,
    description: row.description,
    startSeconds: row.start_seconds,
    playbackId: row.playback_id,
    similarity: Number(row.similarity),
    embeddingText: row.embedding_text,
  }
}

/**
 * Queries scene_embeddings with a pre-computed query embedding vector
 * via pgvector cosine similarity, returning the best-matching scene
 * per video with locale filtering.
 *
 * @param knex           - Knex database connection instance
 * @param params.queryEmbedding - Embedding vector in pgvector text format "[0.1,0.2,...]"
 * @param params.locale  - BCP-47 locale code for variant filtering
 * @param params.limit   - Maximum number of results to return
 */
export async function searchBySemantic(
  knex: KnexInstance,
  params: SemanticSearchParams,
): Promise<SemanticResult[]> {
  const result: { rows: SemanticRow[] } = await knex.raw(SEMANTIC_RANKED_SQL, [
    params.queryEmbedding,
    params.locale,
    params.queryEmbedding,
    params.limit,
  ])

  return result.rows.map(mapRow)
}

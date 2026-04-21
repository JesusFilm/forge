// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KnexInstance = any

export type KeywordSearchParams = {
  query: string
  locale: string
  limit: number
}

export type KeywordResult = {
  videoId: number
  videoSlug: string
  videoTitle: string
  videoCoreId: string | null
  imageUrl: string | null
  description: string | null
  rank: number
}

type KeywordRow = {
  video_id: number
  video_slug: string
  video_title: string
  video_core_id: string | null
  image_url: string | null
  description: string | null
  rank: number
}

/**
 * Full-text keyword search on videos.title and videos.description using
 * PostgreSQL tsvector/tsquery with locale-aware filtering.
 *
 * Uses 'simple' tsvector config for language-agnostic matching in Phase 1.
 * The same locale join chain as the recommender ensures only videos with
 * a published variant in the requested locale are returned.
 *
 * DISTINCT ON (v.id) prevents duplicate rows when a video has multiple
 * variants in the same locale.
 *
 * Join chain for locale filtering (Strapi v5 link tables):
 *   videos.id
 *     -> video_variants_video_lnk.video_id
 *     -> video_variants (published_at IS NOT NULL)
 *     -> video_variants_language_lnk.video_variant_id
 *     -> languages.bcp_47 = $locale
 */
const KEYWORD_SEARCH_SQL = `
  SELECT DISTINCT ON (v.id)
    v.id AS video_id,
    v.slug AS video_slug,
    v.title AS video_title,
    v.core_id AS video_core_id,
    COALESCE(vi.mobile_cinematic_high, vi.url) AS image_url,
    v.description,
    ts_rank(
      to_tsvector('simple', coalesce(v.title, '') || ' ' || coalesce(v.description, '')),
      plainto_tsquery('simple', ?)
    ) AS rank
  FROM videos v
  JOIN video_variants_video_lnk vvl ON vvl.video_id = v.id
  JOIN video_variants vv ON vv.id = vvl.video_variant_id
    AND vv.published_at IS NOT NULL
  JOIN video_variants_language_lnk vll ON vll.video_variant_id = vv.id
  JOIN languages l ON l.id = vll.language_id
    AND l.bcp_47 = ?
  LEFT JOIN LATERAL (
    SELECT vi2.mobile_cinematic_high, vi2.url
    FROM video_images_video_lnk lnk
    JOIN video_images vi2 ON vi2.id = lnk.video_image_id
      AND vi2.published_at IS NOT NULL
    WHERE lnk.video_id = v.id
    ORDER BY lnk.video_image_ord
    LIMIT 1
  ) vi ON true
  WHERE to_tsvector('simple', coalesce(v.title, '') || ' ' || coalesce(v.description, ''))
    @@ plainto_tsquery('simple', ?)
    AND v.published_at IS NOT NULL
  ORDER BY v.id, rank DESC
`

/**
 * Wraps the DISTINCT ON query in a subquery so we can ORDER BY rank
 * descending and apply LIMIT.
 */
const KEYWORD_RANKED_SQL = `
  SELECT * FROM (${KEYWORD_SEARCH_SQL}) sub
  ORDER BY sub.rank DESC
  LIMIT ?
`

function mapRow(row: KeywordRow): KeywordResult {
  return {
    videoId: row.video_id,
    videoSlug: row.video_slug ?? "",
    videoTitle: row.video_title ?? "",
    videoCoreId: row.video_core_id ?? null,
    imageUrl: row.image_url ?? null,
    description: row.description ?? null,
    rank: Number(row.rank),
  }
}

/**
 * Searches videos by keyword using PostgreSQL full-text search.
 *
 * Returns an empty array for empty/whitespace-only queries (plainto_tsquery
 * would produce an empty tsquery which matches nothing, but we short-circuit
 * to avoid the round-trip).
 */
export async function searchByKeyword(
  knex: KnexInstance,
  params: KeywordSearchParams,
): Promise<KeywordResult[]> {
  const trimmed = params.query.trim()
  if (trimmed.length === 0) {
    return []
  }

  const result: { rows: KeywordRow[] } = await knex.raw(KEYWORD_RANKED_SQL, [
    trimmed,
    params.locale,
    trimmed,
    params.limit,
  ])

  return result.rows.map(mapRow)
}

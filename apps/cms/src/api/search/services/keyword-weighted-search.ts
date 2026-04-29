import { WEIGHTED_TSV_EXPR } from "./lexical-sql"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KnexInstance = any

export type KeywordWeightedSearchParams = {
  query: string
  locale: string
  limit: number
}

export type KeywordWeightedResult = {
  videoId: number
  videoSlug: string
  videoTitle: string
  videoCoreId: string | null
  imageUrl: string | null
  description: string | null
  rank: number
}

type KeywordWeightedRow = {
  video_id: number
  video_slug: string
  video_title: string
  video_core_id: string | null
  image_url: string | null
  description: string | null
  rank: number
}

/**
 * Phrase-aware, per-field weighted full-text retrieval used by the
 * keyword-first mode (feat-109).
 *
 * Differs from `searchByKeyword` in two ways:
 *   - `websearch_to_tsquery` preserves phrase adjacency and accepts
 *     user-typed double-quotes as exact phrases (Algolia-like).
 *   - The tsvector is the *weighted* per-field combination
 *     `(setweight(title_tsv,'A') || setweight(description_tsv,'B'))`,
 *     so title hits outrank description hits.
 *
 * The expression is sourced from `lexical-sql.ts` so it matches the
 * GIN index byte-for-byte (drift = silent Seq Scan).
 *
 * Locale + publish-state filtering is identical to `searchByKeyword`.
 *
 * Returns an empty array for empty/whitespace-only queries (mirrors
 * `searchByKeyword`'s short-circuit; avoids a round-trip with a
 * tsquery that matches nothing).
 */
const KEYWORD_WEIGHTED_SQL = `
  SELECT DISTINCT ON (v.id)
    v.id AS video_id,
    v.slug AS video_slug,
    v.title AS video_title,
    v.core_id AS video_core_id,
    COALESCE(vi.mobile_cinematic_high, vi.url) AS image_url,
    v.description,
    ts_rank_cd(
      ${WEIGHTED_TSV_EXPR},
      websearch_to_tsquery('simple', ?)
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
  WHERE ${WEIGHTED_TSV_EXPR} @@ websearch_to_tsquery('simple', ?)
    AND v.published_at IS NOT NULL
  ORDER BY v.id, rank DESC
`

const KEYWORD_WEIGHTED_RANKED_SQL = `
  SELECT * FROM (${KEYWORD_WEIGHTED_SQL}) sub
  ORDER BY sub.rank DESC
  LIMIT ?
`

function mapRow(row: KeywordWeightedRow): KeywordWeightedResult {
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

export async function searchByKeywordWeighted(
  knex: KnexInstance,
  params: KeywordWeightedSearchParams,
): Promise<KeywordWeightedResult[]> {
  const trimmed = params.query.trim()
  if (trimmed.length === 0) {
    return []
  }

  const result: { rows: KeywordWeightedRow[] } = await knex.raw(
    KEYWORD_WEIGHTED_RANKED_SQL,
    [trimmed, params.locale, trimmed, params.limit],
  )

  return result.rows.map(mapRow)
}

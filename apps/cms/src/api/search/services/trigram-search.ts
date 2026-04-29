// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KnexInstance = any

export type TrigramSearchParams = {
  query: string
  locale: string
  limit: number
}

export type TrigramResult = {
  videoId: number
  videoSlug: string
  videoTitle: string
  videoCoreId: string | null
  imageUrl: string | null
  description: string | null
  similarity: number
}

type TrigramRow = {
  video_id: number
  video_slug: string
  video_title: string
  video_core_id: string | null
  image_url: string | null
  description: string | null
  similarity: number
}

/**
 * Trigram word-similarity retrieval over `videos.title` used by the
 * keyword-first mode (feat-109).
 *
 * Closes the typo / partial-prefix gap that `websearch_to_tsquery`
 * misses: `q="bibel project"` won't match a tsvector lemma but will
 * still score highly here, because pg_trgm computes character-trigram
 * overlap.
 *
 * Uses the `%>` operator ("word similar to") rather than `%`, which
 * tends to overmatch on long descriptions. Title-only — see plan: the
 * description trigram index would balloon without meaningful gain.
 *
 * The companion GIN trigram index on `videos.title gin_trgm_ops`
 * (provisioned in `ensure-search-lexical.ts`) is the index this
 * planner targets. Drift in the operator or index expression silently
 * disables index use.
 *
 * Locale + publish-state filtering identical to `searchByKeyword`.
 *
 * Returns `[]` for empty input.
 */
const TRIGRAM_SQL = `
  SELECT DISTINCT ON (v.id)
    v.id AS video_id,
    v.slug AS video_slug,
    v.title AS video_title,
    v.core_id AS video_core_id,
    COALESCE(vi.mobile_cinematic_high, vi.url) AS image_url,
    v.description,
    similarity(v.title, ?) AS similarity
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
  WHERE v.title %> ?
    AND v.published_at IS NOT NULL
  ORDER BY v.id, similarity DESC
`

const TRIGRAM_RANKED_SQL = `
  SELECT * FROM (${TRIGRAM_SQL}) sub
  ORDER BY sub.similarity DESC
  LIMIT ?
`

function mapRow(row: TrigramRow): TrigramResult {
  return {
    videoId: row.video_id,
    videoSlug: row.video_slug ?? "",
    videoTitle: row.video_title ?? "",
    videoCoreId: row.video_core_id ?? null,
    imageUrl: row.image_url ?? null,
    description: row.description ?? null,
    similarity: Number(row.similarity),
  }
}

export async function searchByTrigram(
  knex: KnexInstance,
  params: TrigramSearchParams,
): Promise<TrigramResult[]> {
  const trimmed = params.query.trim()
  if (trimmed.length === 0) {
    return []
  }

  const result: { rows: TrigramRow[] } = await knex.raw(TRIGRAM_RANKED_SQL, [
    trimmed,
    params.locale,
    trimmed,
    params.limit,
  ])

  return result.rows.map(mapRow)
}

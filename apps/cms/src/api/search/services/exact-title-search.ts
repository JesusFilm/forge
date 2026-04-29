// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KnexInstance = any

export type ExactTitleSearchParams = {
  query: string
  locale: string
  limit: number
}

export type ExactTitleResult = {
  videoId: number
  videoSlug: string
  videoTitle: string
  videoCoreId: string | null
  imageUrl: string | null
  description: string | null
  /**
   * Title length in characters (shorter title with all tokens present →
   * tighter match → higher rank). Inverse-ranked at the SQL boundary so
   * the orchestrator can fuse this list as "best first" alongside the
   * other keyword-first retrievers.
   */
  titleLength: number
}

type ExactTitleRow = {
  video_id: number
  video_slug: string
  video_title: string
  video_core_id: string | null
  image_url: string | null
  description: string | null
  title_length: number
}

const PUNCTUATION_RE = /[^\p{L}\p{N}]+/u

/**
 * Maximum query tokens fed into the AND-chain of ILIKE clauses. Caps the
 * worst-case planner stack growth from a pathological pasted query
 * (review finding: unbounded AND-chain is a resource-exhaustion vector).
 * 16 is comfortably above any natural-language search title; longer
 * queries are truncated rather than rejected so a clipboard accident
 * doesn't surface as a 4xx to the user.
 */
const MAX_EXACT_TITLE_TOKENS = 16

/**
 * Tokenize a query into "all-tokens-must-appear-in-title" parts.
 *
 * Splits on Unicode non-letter/non-digit boundaries, lowercases and
 * trims, drops empties, then caps at MAX_EXACT_TITLE_TOKENS to bound
 * the predicate count. This is whitespace + punctuation stripping in
 * one pass — the result is the set of words an exact-title retriever
 * requires to ALL appear (case-insensitive) in the title.
 */
export function tokenizeForExactTitle(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .split(PUNCTUATION_RE)
    .filter((token) => token.length > 0)
  return tokens.slice(0, MAX_EXACT_TITLE_TOKENS)
}

function buildRankedSql(tokenCount: number): string {
  // One ILIKE per token, all ANDed. Each ? takes the wrapped pattern
  // `%token%` from the bindings array. Generated dynamically so the
  // number of placeholders matches the token count exactly — Postgres
  // rejects unbound parameters at parse time, which is the safe
  // failure mode here.
  const ilikeChain = Array.from(
    { length: tokenCount },
    () => "v.title ILIKE ?",
  ).join("\n      AND ")
  const sql = `
    SELECT DISTINCT ON (v.id)
      v.id AS video_id,
      v.slug AS video_slug,
      v.title AS video_title,
      v.core_id AS video_core_id,
      COALESCE(vi.mobile_cinematic_high, vi.url) AS image_url,
      v.description,
      LENGTH(v.title) AS title_length
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
    WHERE ${ilikeChain}
      AND v.published_at IS NOT NULL
    ORDER BY v.id, title_length ASC
  `

  return `
    SELECT * FROM (${sql}) sub
    ORDER BY sub.title_length ASC
    LIMIT ?
  `
}

function mapRow(row: ExactTitleRow): ExactTitleResult {
  return {
    videoId: row.video_id,
    videoSlug: row.video_slug ?? "",
    videoTitle: row.video_title ?? "",
    videoCoreId: row.video_core_id ?? null,
    imageUrl: row.image_url ?? null,
    description: row.description ?? null,
    titleLength: Number(row.title_length),
  }
}

/**
 * Exact-title-match retriever for the keyword-first mode (feat-109).
 *
 * Returns videos whose title contains EVERY query token (case-
 * insensitive, punctuation-stripped). Ranked shortest-title first —
 * the shorter the title, the tighter the match (a 3-word title that
 * contains all 3 tokens wins over a 12-word title that contains all 3
 * plus 9 unrelated words).
 *
 * Wired into RRF as the 4th list in keyword-first mode. Together with
 * `searchByKeywordWeighted` and `searchByTrigram`, it produces the
 * "every query token must appear in the most-important attribute"
 * Algolia-like behavior the research report (§7) calls for.
 *
 * Returns `[]` for empty/whitespace-only or all-punctuation queries
 * (no tokens → no rows would match the AND chain anyway, so we
 * short-circuit).
 */
export async function searchByExactTitle(
  knex: KnexInstance,
  params: ExactTitleSearchParams,
): Promise<ExactTitleResult[]> {
  const tokens = tokenizeForExactTitle(params.query)
  if (tokens.length === 0) {
    return []
  }

  const rankedSql = buildRankedSql(tokens.length)

  const bindings = [params.locale, ...tokens.map((t) => `%${t}%`), params.limit]

  const result: { rows: ExactTitleRow[] } = await knex.raw(rankedSql, bindings)

  return result.rows.map(mapRow)
}

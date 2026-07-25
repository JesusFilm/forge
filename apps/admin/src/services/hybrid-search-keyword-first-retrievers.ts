/**
 * Three lexical retrievers that feed the keyword-first branch of the
 * hybrid-search RRF orchestrator. Sibling of `hybrid-search-retrievers.ts`
 * (R4) — same shape contract (`RankedItem`-conformant rows, no
 * `annotateVideo` step), different SQL.
 *
 * Schema attachment: title + description live on `VideoLocale` in admin
 * (per-locale rows), so the new GIN indexes provisioned by
 * `0009_keyword_first_lexical/migration.sql` attach to `video_locale`,
 * not `video`. Locale filter is `vl.locale = ?` (direct column) — admin
 * does NOT use a `bcp_47` link-table chain like cms's link tables.
 *
 * Consumer visibility gate is identical to R4's `searchVideoKeyword`:
 *   - `v.deleted_at IS NULL` (Video tombstone)
 *   - `vl.status = 'published'` (per-locale publish state)
 *
 * Re-derived from cms's keyword-weighted, trigram, and exact-title
 * retrievers; SQL shape ports, column names + locale filter do not.
 * Per docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md.
 */

import { Prisma, type PrismaClient } from "@prisma/client"
import { WEIGHTED_TSV_QUERY_EXPR } from "./hybrid-search-sql"
import type { RankedItem } from "./hybrid-search-fusion"
import {
  recordSearchDbTiming,
  type SearchTimingRecorder,
} from "./hybrid-search-timing"

// -----------------------------------------------------------------------------
// Shared parameter shapes
// -----------------------------------------------------------------------------

export type KeywordWeightedSearchParams = {
  query: string
  locale: string
  limit: number
}

export type TrigramSearchParams = {
  query: string
  locale: string
  limit: number
}

export type ExactTitleSearchParams = {
  query: string
  locale: string
  limit: number
}

export type KeywordFirstVideoLexicalSearchParams = {
  query: string
  locale: string
  limit: number
}

// -----------------------------------------------------------------------------
// Return shapes — all three carry the same row contract as R4's
// `searchVideoKeyword`, plus a retriever-specific score field
// (`rank` for tsvector retrievers, `similarity` for trigram,
// `titleLength` for exact-title). Keeps the orchestrator's
// `mapToSearchResult` keyword-row branch untouched.
// -----------------------------------------------------------------------------

type VideoKeywordRowShape = RankedItem & {
  resultType: "video"
  resultId: string
  videoCoreId: string | null
  videoSlug: string
  videoTitle: string
  imageUrl: null
  description: string | null
}

export type KeywordWeightedResult = VideoKeywordRowShape & { rank: number }
/**
 * Result row from `searchByTrigram`. **As of migration 0010, `similarity`
 * is the GREATEST of the title-side and description-side trigram
 * similarities** (`similarity(vl.title, q)` vs
 * `similarity(coalesce(vl.description, ''), q)`), not title-only as it
 * was pre-0010. The retriever scans both columns and dedupes per video
 * via `DISTINCT ON (v.id)`, keeping the higher-similarity row.
 */
export type TrigramResult = VideoKeywordRowShape & { similarity: number }
export type ExactTitleResult = VideoKeywordRowShape & { titleLength: number }

export type KeywordFirstVideoLexicalResults = {
  keywordWeighted: KeywordWeightedResult[]
  trigram: TrigramResult[]
  exactTitle: ExactTitleResult[]
}

// -----------------------------------------------------------------------------
// Internal raw-row shapes
// -----------------------------------------------------------------------------

type KeywordWeightedRow = {
  video_id: string
  video_core_id: string | null
  video_slug: string | null
  video_title: string | null
  description: string | null
  rank: number
}

type TrigramRow = {
  video_id: string
  video_core_id: string | null
  video_slug: string | null
  video_title: string | null
  description: string | null
  similarity: number
}

type ExactTitleRow = {
  video_id: string
  video_core_id: string | null
  video_slug: string | null
  video_title: string | null
  description: string | null
  title_length: number
}

type QueryRawClient = Pick<PrismaClient, "$queryRaw">

const KEYWORD_FIRST_LEXICAL_TRANSACTION_MAX_WAIT_MS = 5_000
const KEYWORD_FIRST_LEXICAL_TRANSACTION_TIMEOUT_MS = 20_000

// -----------------------------------------------------------------------------
// Exact-title tokenizer + DoS cap
// -----------------------------------------------------------------------------

const PUNCTUATION_RE = /[^\p{L}\p{N}]+/u

/**
 * Maximum query tokens fed into the AND-chain of `vl.title ILIKE ?`
 * clauses. Caps planner stack growth from a pathological pasted query
 * (a 1MB clipboard accident shouldn't widen the WHERE clause to a
 * thousand predicates). 16 is well above any natural-language search
 * title; longer queries are truncated rather than rejected so users
 * see results instead of a 4xx.
 *
 * Carried over verbatim from cms feat-109's `MAX_EXACT_TITLE_TOKENS`.
 */
export const MAX_EXACT_TITLE_TOKENS = 16

/**
 * Tokenize a query into "all-tokens-must-appear-in-title" parts.
 *
 * Splits on Unicode non-letter / non-digit boundaries, lowercases,
 * drops empties, **deduplicates** (so a 16-repeat-of-one-token query
 * doesn't burn the cap on identical predicates), then caps at
 * `MAX_EXACT_TITLE_TOKENS` to bound the planner stack. Whitespace +
 * punctuation stripping in one pass.
 *
 * Dedup happens BEFORE the cap so leading duplicates can't push later
 * unique tokens out of the window.
 */
export function tokenizeForExactTitle(query: string): string[] {
  const seen = new Set<string>()
  const tokens: string[] = []
  for (const part of query.toLowerCase().split(PUNCTUATION_RE)) {
    if (part.length === 0 || seen.has(part)) continue
    seen.add(part)
    tokens.push(part)
    if (tokens.length === MAX_EXACT_TITLE_TOKENS) break
  }
  return tokens
}

// -----------------------------------------------------------------------------
// Retrievers
// -----------------------------------------------------------------------------

/**
 * Phrase-aware, per-field weighted full-text retrieval.
 *
 * `websearch_to_tsquery('simple', ?)` accepts user-typed double-quotes
 * as exact phrases (Algolia-like). Ranking uses `ts_rank_cd` against
 * the per-field weighted tsvector
 * `(setweight(vl.title_tsv,'A') || setweight(vl.description_tsv,'B'))`
 * so a query word in the title outranks the same word in the
 * description. The expression is sourced from `WEIGHTED_TSV_QUERY_EXPR`
 * in `hybrid-search-sql.ts` so it stays byte-equal to the GIN index
 * created by `0009_keyword_first_lexical/migration.sql`. Drift =
 * silent Seq Scan.
 *
 * Empty / whitespace input short-circuits to `[]`.
 */
export async function searchByKeywordWeighted(
  prisma: QueryRawClient,
  params: KeywordWeightedSearchParams,
  timing?: SearchTimingRecorder,
): Promise<KeywordWeightedResult[]> {
  const trimmed = params.query.trim()
  if (trimmed.length === 0) return []

  const { locale, limit } = params
  const tsvector = Prisma.raw(WEIGHTED_TSV_QUERY_EXPR)

  const rows = await recordSearchDbTiming(
    timing,
    "keyword-weighted-video.query",
    () => prisma.$queryRaw<KeywordWeightedRow[]>`
      SELECT * FROM (
        SELECT DISTINCT ON (v.id)
          v.id           AS video_id,
          v.core_id      AS video_core_id,
          v.slug         AS video_slug,
          vl.title       AS video_title,
          vl.description AS description,
          ts_rank_cd(
            ${tsvector},
            websearch_to_tsquery('simple', ${trimmed})
          ) AS rank
        FROM video_locale vl
        JOIN video v ON v.id = vl.video_id
          AND v.deleted_at IS NULL
          AND v.no_index = false
        WHERE ${tsvector} @@ websearch_to_tsquery('simple', ${trimmed})
          AND vl.locale = ${locale}
          AND vl.status = 'published'
          AND vl.deleted_at IS NULL
        ORDER BY v.id, rank DESC
      ) sub
      ORDER BY sub.rank DESC
      LIMIT ${limit}
    `,
  )

  return rows.map((row) => ({
    resultType: "video" as const,
    resultId: row.video_id,
    videoCoreId: row.video_core_id,
    videoSlug: row.video_slug ?? "",
    videoTitle: row.video_title ?? "",
    imageUrl: null,
    description: row.description,
    rank: Number(row.rank),
  }))
}

/**
 * Trigram word-similarity retrieval over `video_locale.title` AND
 * `video_locale.description`.
 *
 * Closes the typo / partial-prefix / CamelCase gap that
 * `websearch_to_tsquery` misses:
 *   - `q="bibel project"` (typo) won't match a tsvector lemma but
 *     scores highly via character-trigram overlap.
 *   - `q="the bible project"` against a description writing the brand
 *     as the joined-form `BibleProject` matches via description
 *     trigrams (the brand's 3-grams overlap `bibleproject` directly).
 *
 * SQL shape: `WHERE (vl.title %> ? OR vl.description %> ?)` plus
 * `DISTINCT ON (v.id) ORDER BY v.id, similarity DESC` to collapse
 * rows that match via both fields, keeping the higher-similarity row.
 * Ranking is `GREATEST(similarity(vl.title, q), similarity(coalesce(vl.description, ''), q))`
 * so a strong title match doesn't get diluted by a weak description
 * match.
 *
 * (Earlier framings called this a "UNION" — implementation is the
 * equivalent OR + per-row dedup, which lets a single index probe pass
 * cover both halves and avoids materializing two intermediate row
 * sets.)
 *
 * Index selection happens via the `%>` operator against
 * `video_locale_title_trgm_idx` (provisioned by 0009) and
 * `video_locale_description_trgm_idx` (provisioned by 0010), both
 * operator-class GIN (`gin_trgm_ops`). On a populated table the
 * planner should choose `BitmapOr` over the two indexes; on an empty
 * corpus it correctly prefers Seq Scan. No expression byte-parity
 * guard needed — operator-class indexes are selected by the operator
 * regardless of column aliases. Per
 * docs/solutions/best-practices/gin-byte-parity-trigram-vs-expression-indexes-20260429.md.
 *
 * Empty input short-circuits to `[]`.
 */
export async function searchByTrigram(
  prisma: QueryRawClient,
  params: TrigramSearchParams,
  timing?: SearchTimingRecorder,
): Promise<TrigramResult[]> {
  const trimmed = params.query.trim()
  if (trimmed.length === 0) return []

  const { locale, limit } = params

  const rows = await recordSearchDbTiming(
    timing,
    "trigram-video.query",
    () => prisma.$queryRaw<TrigramRow[]>`
      SELECT * FROM (
        SELECT DISTINCT ON (v.id)
          v.id           AS video_id,
          v.core_id      AS video_core_id,
          v.slug         AS video_slug,
          vl.title       AS video_title,
          vl.description AS description,
          GREATEST(
            similarity(vl.title, ${trimmed}),
            similarity(coalesce(vl.description, ''), ${trimmed})
          ) AS similarity
        FROM video_locale vl
        JOIN video v ON v.id = vl.video_id
          AND v.deleted_at IS NULL
          AND v.no_index = false
        WHERE (vl.title %> ${trimmed} OR vl.description %> ${trimmed})
          AND vl.locale = ${locale}
          AND vl.status = 'published'
          AND vl.deleted_at IS NULL
        ORDER BY v.id, similarity DESC
      ) sub
      ORDER BY sub.similarity DESC
      LIMIT ${limit}
    `,
  )

  return rows.map((row) => ({
    resultType: "video" as const,
    resultId: row.video_id,
    videoCoreId: row.video_core_id,
    videoSlug: row.video_slug ?? "",
    videoTitle: row.video_title ?? "",
    imageUrl: null,
    description: row.description,
    similarity: Number(row.similarity),
  }))
}

/**
 * Exact-token-in-title retriever.
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
 * Algolia-like behavior the keyword-first plan calls for.
 *
 * Token count is capped at `MAX_EXACT_TITLE_TOKENS` (16) — see
 * `tokenizeForExactTitle`. Empty / whitespace-only / all-punctuation
 * queries short-circuit to `[]`.
 *
 * Dynamic AND-chain composed via `Prisma.join` so the bound parameter
 * count exactly matches the token count. Postgres rejects unbound
 * placeholders at parse time, which is the safe failure mode.
 */
export async function searchByExactTitle(
  prisma: QueryRawClient,
  params: ExactTitleSearchParams,
  timing?: SearchTimingRecorder,
): Promise<ExactTitleResult[]> {
  const tokens = tokenizeForExactTitle(params.query)
  if (tokens.length === 0) return []

  const { locale, limit } = params

  // One ILIKE per token, ANDed. Each bound to its own parameter via
  // `Prisma.sql` template fragment; `Prisma.join` composes them.
  const ilikeChain = Prisma.join(
    tokens.map((token) => Prisma.sql`vl.title ILIKE ${`%${token}%`}`),
    " AND ",
  )

  const rows = await recordSearchDbTiming(
    timing,
    "exact-title-video.query",
    () => prisma.$queryRaw<ExactTitleRow[]>`
      SELECT * FROM (
        SELECT DISTINCT ON (v.id)
          v.id            AS video_id,
          v.core_id       AS video_core_id,
          v.slug          AS video_slug,
          vl.title        AS video_title,
          vl.description  AS description,
          LENGTH(vl.title) AS title_length
        FROM video_locale vl
        JOIN video v ON v.id = vl.video_id
          AND v.deleted_at IS NULL
          AND v.no_index = false
        WHERE ${ilikeChain}
          AND vl.locale = ${locale}
          AND vl.status = 'published'
          AND vl.deleted_at IS NULL
        ORDER BY v.id, title_length ASC
      ) sub
      ORDER BY sub.title_length ASC
      LIMIT ${limit}
    `,
  )

  return rows.map((row) => ({
    resultType: "video" as const,
    resultId: row.video_id,
    videoCoreId: row.video_core_id,
    videoSlug: row.video_slug ?? "",
    videoTitle: row.video_title ?? "",
    imageUrl: null,
    description: row.description,
    titleLength: Number(row.title_length),
  }))
}

/**
 * Run the keyword-first video lexical stack on one DB connection.
 *
 * The three underlying SQL queries stay byte-for-byte owned by their
 * retrievers above; this helper changes only connection scheduling. In
 * production that cuts pool fan-out from three concurrent video-lexical
 * connections to one transaction-bound connection while preserving the
 * three logical result lists consumed by RRF, debug attribution, and the
 * dilution cap.
 */
export async function searchKeywordFirstVideoLexical(
  prisma: PrismaClient,
  params: KeywordFirstVideoLexicalSearchParams,
  timing?: SearchTimingRecorder,
): Promise<KeywordFirstVideoLexicalResults> {
  if (params.query.trim().length === 0) {
    return {
      keywordWeighted: [],
      trigram: [],
      exactTitle: [],
    }
  }

  return prisma.$transaction(
    async (tx) => {
      const client: QueryRawClient = tx
      return {
        keywordWeighted: await searchByKeywordWeighted(client, params, timing),
        trigram: await searchByTrigram(client, params, timing),
        exactTitle: await searchByExactTitle(client, params, timing),
      }
    },
    {
      maxWait: KEYWORD_FIRST_LEXICAL_TRANSACTION_MAX_WAIT_MS,
      timeout: KEYWORD_FIRST_LEXICAL_TRANSACTION_TIMEOUT_MS,
    },
  )
}

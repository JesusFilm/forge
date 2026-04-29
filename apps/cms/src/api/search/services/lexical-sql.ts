/**
 * Shared SQL fragments for the opt-in keyword-first lexical search mode
 * (feat-109). The bootstrap module (`ensure-search-lexical.ts`) and the
 * keyword-first retrievers must reference the SAME tsvector / trigram
 * expressions byte-for-byte — any drift between the indexed expression
 * and the query expression silently disables the GIN index and the
 * planner falls back to Seq Scan.
 *
 * This file is the single source of truth for those expressions. Tests
 * assert byte-equality between the bootstrap SQL and these constants.
 *
 * See `apps/admin/src/services/hybrid-search-sql.ts` for the canonical
 * R4 byte-parity pattern this mirrors.
 */

/**
 * Generated-column expression for `videos.title_tsv`.
 *
 * `to_tsvector('simple', coalesce(title, ''))` — the 'simple' config is
 * language-agnostic (matches the existing keyword path on this codebase)
 * and `coalesce(..., '')` keeps NULL titles from breaking the generated
 * column.
 */
export const TITLE_TSV_GENERATED_EXPR =
  "to_tsvector('simple', coalesce(title, ''))"

/**
 * Generated-column expression for `videos.description_tsv`. Same shape
 * as title; weighted lower (B) when fused into the search vector below.
 */
export const DESCRIPTION_TSV_GENERATED_EXPR =
  "to_tsvector('simple', coalesce(description, ''))"

/**
 * Per-field weighted tsvector used by the keyword-first weighted
 * retriever AND by the GIN index in `ensure-search-lexical.ts`. Title
 * weighted A (highest), description weighted B (next). Together they
 * give per-field rank in `ts_rank_cd` and let the planner choose the
 * GIN index when this exact expression appears in WHERE.
 *
 * The index is created over this expression; the retriever's WHERE and
 * `ts_rank_cd` arguments must reference this exact string. Drift =
 * silent Seq Scan.
 */
export const WEIGHTED_TSV_EXPR =
  "(setweight(title_tsv, 'A') || setweight(description_tsv, 'B'))"

/**
 * Trigram operator used in the trigram retriever's WHERE clause. The
 * `%>` operator returns true when one string is similar to a *word* in
 * the other — better fit for prefix / typo matching against title than
 * the looser `%` operator.
 *
 * The companion GIN index is created with `gin_trgm_ops` on
 * `videos.title`; the planner uses it when WHERE matches `title %> ?`
 * with this operator literally.
 */
export const TITLE_TRIGRAM_OP = "videos.title %> ?"

/**
 * GIN index expression strings — kept here so the bootstrap module and
 * any future verifier (e.g. an `EXPLAIN`-based regression test) build
 * from the same source.
 */
export const VIDEOS_LEXICAL_WEIGHTED_INDEX_NAME = "videos_lexical_weighted_idx"
export const VIDEOS_TITLE_TRGM_INDEX_NAME = "videos_title_trgm_idx"

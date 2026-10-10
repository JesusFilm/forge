/**
 * Shared SQL fragments for admin's hybrid-search keyword retrievers.
 *
 * Two sections:
 *  1. R4 baseline — `*_TSVECTOR_*_EXPR` constants for the concatenated
 *     tsvector retrievers backed by `video_locale_fulltext_search_idx` /
 *     `experience_locale_fulltext_search_idx` from
 *     `0006_hybrid_search_gin/migration.sql`.
 *  2. R4-extension keyword-first — `*_TSV_GENERATED_EXPR`,
 *     `WEIGHTED_TSV_*_EXPR`, and index-name constants for the per-field
 *     weighted GIN + trigram retrievers backed by
 *     `0009_keyword_first_lexical/migration.sql`. Touching either
 *     section can drift byte-parity for the other; both are guarded by
 *     `hybrid-search-sql.test.ts`.
 *
 * Keyword search in Postgres uses a `to_tsvector(...)` expression evaluated
 * on `video_locale` and `experience_locale`. A GIN index over the SAME
 * expression lets the planner serve the matching predicate from the index
 * rather than a sequential scan. If the service's expression and the GIN
 * index's expression are not byte-equal (whitespace, quoting, column
 * order, even alias prefixing) the planner silently falls back to seq
 * scan on large corpora — the corpus still ranks, just slowly, so
 * there's no runtime error to catch the drift.
 *
 * To guarantee byte-parity we centralize the expression here in two
 * forms per corpus:
 *
 *   - `*_INDEX_EXPR` — bare column references (`title`, `description`,
 *     `meta_description`). Used verbatim in `CREATE INDEX ... USING GIN
 *     (<expr>)` at migration time, where the expression is evaluated in
 *     the table's own scope (no alias).
 *
 *   - `*_QUERY_EXPR` — alias-prefixed column references (`vl.title`,
 *     `el.meta_description`). Used inside service-layer `$queryRaw`
 *     strings where `video_locale` is joined as `vl` and
 *     `experience_locale` as `el`. Postgres treats the two forms as
 *     equivalent for index matching because the planner normalizes
 *     alias-qualified column references to their unqualified form
 *     before comparing against the indexed expression.
 *
 * The byte-parity invariant only needs to hold between each
 * `*_INDEX_EXPR` and the corresponding raw SQL written into
 * `prisma/migrations/0006_hybrid_search_gin/migration.sql`. That
 * invariant is enforced by `hybrid-search-sql.test.ts`, which reads
 * the migration file and asserts both index-form constants appear
 * verbatim as substrings. If a future edit changes one side but
 * not the other, the test fails.
 *
 * Config is `'simple'` (language-agnostic) — matches cms's
 * `keyword-search.ts` / `experience-keyword-search.ts`. No locale-
 * specific stemming is applied. Locale filtering happens via a
 * separate `WHERE locale = ?` clause on the row, not through the
 * tsvector config.
 */

/**
 * Video-locale tsvector expression, INDEX form (bare columns).
 *
 * Used by `prisma/migrations/0006_hybrid_search_gin/migration.sql` to
 * create `video_locale_fulltext_search_idx`. Must appear byte-equal in
 * that migration.
 */
export const VIDEO_LOCALE_TSVECTOR_INDEX_EXPR =
  "to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))"

/**
 * Video-locale tsvector expression, QUERY form (aliased columns).
 *
 * Intended for service-layer SQL where `video_locale` is joined as
 * `vl`. Postgres matches this against `video_locale_fulltext_search_idx`
 * because the planner strips alias prefixes before comparing the
 * expression to the indexed expression.
 */
export const VIDEO_LOCALE_TSVECTOR_QUERY_EXPR =
  "to_tsvector('simple', coalesce(vl.title, '') || ' ' || coalesce(vl.description, ''))"

/**
 * Experience-locale tsvector expression, INDEX form (bare columns).
 *
 * Used by `prisma/migrations/0006_hybrid_search_gin/migration.sql` to
 * create `experience_locale_fulltext_search_idx`. Must appear byte-
 * equal in that migration.
 */
export const EXPERIENCE_LOCALE_TSVECTOR_INDEX_EXPR =
  "to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(meta_description, ''))"

/**
 * Experience-locale tsvector expression, QUERY form (aliased columns).
 *
 * Intended for service-layer SQL where `experience_locale` is joined
 * as `el`. Planner-equivalent to the INDEX form — see file header.
 */
export const EXPERIENCE_LOCALE_TSVECTOR_QUERY_EXPR =
  "to_tsvector('simple', coalesce(el.title, '') || ' ' || coalesce(el.meta_description, ''))"

// -----------------------------------------------------------------------------
// R4-extension: keyword-first lexical search expressions.
//
// The keyword-first mode adds three lexical retrievers on top of R4's
// hybrid foundation. Two of them — `searchByKeywordWeighted` and the
// generated-column expressions that back it — share the same byte-parity
// discipline as R4's `*_TSVECTOR_*_EXPR` pair: a GIN index in
// `0009_keyword_first_lexical/migration.sql` is created over the
// expression below, so any drift between the constants here and the
// migration silently reverts the retriever to seq scan.
//
// The trigram retriever (`searchByTrigram`) uses operator-class GIN
// (`gin_trgm_ops`) and does NOT need a shared constant — index
// selection happens via the operator (`%>`), not the expression. Per
// docs/solutions/best-practices/gin-byte-parity-trigram-vs-expression-indexes-20260429.md.
//
// The generated-column expressions (`*_GENERATED_EXPR`) cannot be
// changed via `ALTER COLUMN ... GENERATED` — Postgres has no
// in-place editor for stored generated expressions. Any future
// rewrite requires a coordinated `DROP COLUMN ... CASCADE + ADD
// COLUMN ... GENERATED ALWAYS AS (...)` migration. Per
// docs/solutions/database-issues/postgres-generated-column-drift-add-column-if-not-exists-20260429.md.
// -----------------------------------------------------------------------------

/**
 * Generated-column expression for `video_locale.title_tsv`.
 *
 * Used by `prisma/migrations/0010_camelcase_tsv_and_description_trigram/migration.sql`
 * (which superseded the original `0009_keyword_first_lexical/migration.sql`
 * definition) inside `ALTER TABLE video_locale ADD COLUMN title_tsv
 * tsvector GENERATED ALWAYS AS (<expr>) STORED`. Must appear byte-equal
 * in the migration. Service code never references this expression
 * directly — the column it produces (`title_tsv`) is what queries read.
 *
 * The `regexp_replace` injects a space at every camelCase boundary
 * (`BibleProject` → `Bible Project`) BEFORE `to_tsvector` runs, so the
 * single lexeme `bibleproject` becomes the two lexemes `bible` + `project`
 * and a user query of `"the bible project"` (which
 * `websearch_to_tsquery` parses as `'the' & 'bible' & 'project'`)
 * matches descriptions where the brand is written joined-form. Regex
 * is the conservative `([a-z])([A-Z])` form: preserves all-caps
 * acronyms like `YHWH` / `LORD` intact while still splitting
 * two-segment CamelCase. See
 * `docs/plans/2026-05-02-001-fix-keyword-first-camelcase-recall-plan.md`.
 */
export const TITLE_TSV_GENERATED_EXPR =
  "to_tsvector('simple', regexp_replace(coalesce(title, ''), '([a-z])([A-Z])', '\\1 \\2', 'g'))"

/**
 * Generated-column expression for `video_locale.description_tsv`.
 *
 * Same byte-parity contract as `TITLE_TSV_GENERATED_EXPR`, same
 * CamelCase-split rationale. Service code reads the resulting
 * `description_tsv` column rather than recomputing the expression.
 */
export const DESCRIPTION_TSV_GENERATED_EXPR =
  "to_tsvector('simple', regexp_replace(coalesce(description, ''), '([a-z])([A-Z])', '\\1 \\2', 'g'))"

/**
 * Per-field weighted tsvector expression, INDEX form (bare columns).
 *
 * Used by `prisma/migrations/0009_keyword_first_lexical/migration.sql`
 * to create `video_locale_lexical_weighted_idx`. Title (`A`) outranks
 * description (`B`) so a query word in the title beats the same word
 * in the description on `ts_rank_cd`.
 *
 * Must appear byte-equal in the migration.
 */
export const WEIGHTED_TSV_INDEX_EXPR =
  "setweight(title_tsv, 'A') || setweight(description_tsv, 'B')"

/**
 * Per-field weighted tsvector expression, QUERY form (aliased columns).
 *
 * Intended for service-layer SQL where `video_locale` is joined as
 * `vl`. Postgres's planner strips alias prefixes before matching the
 * expression against `video_locale_lexical_weighted_idx`, so the
 * INDEX form and QUERY form are equivalent for index selection — the
 * same property R4's `*_TSVECTOR_*_EXPR` pair already relies on.
 */
export const WEIGHTED_TSV_QUERY_EXPR =
  "setweight(vl.title_tsv, 'A') || setweight(vl.description_tsv, 'B')"

/**
 * Index name for the weighted GIN index on `video_locale`.
 *
 * Centralized so tests, migration assertions, and `EXPLAIN ANALYZE`
 * runbooks reference one canonical string.
 */
export const VIDEO_LOCALE_LEXICAL_WEIGHTED_INDEX_NAME =
  "video_locale_lexical_weighted_idx"

/**
 * Index name for the trigram GIN index on `video_locale.title`.
 *
 * Trigram path uses `gin_trgm_ops` operator-class — no expression
 * byte-parity guard needed; this constant exists only so tests and
 * runbooks share one canonical name.
 */
export const VIDEO_LOCALE_TITLE_TRGM_INDEX_NAME = "video_locale_title_trgm_idx"

/**
 * Index name for the trigram GIN index on `video_locale.description`.
 *
 * Provisioned by
 * `0010_camelcase_tsv_and_description_trigram/migration.sql`. Backs the
 * description-side of `searchByTrigram` (`vl.description %> q`), which
 * the planner picks up by operator-class match — production code never
 * names the index. **Exported only so the byte-parity test can assert
 * the migration creates the index under a name we control; no
 * production consumer references this constant.** Same shape as
 * `VIDEO_LOCALE_TITLE_TRGM_INDEX_NAME` (also test-only).
 */
export const VIDEO_LOCALE_DESCRIPTION_TRGM_INDEX_NAME =
  "video_locale_description_trgm_idx"

/**
 * Shared SQL fragments for admin's R4 hybrid-search keyword retrievers.
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

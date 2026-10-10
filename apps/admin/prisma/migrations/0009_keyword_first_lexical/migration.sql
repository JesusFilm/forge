-- R4-extension: keyword-first lexical search infrastructure.
--
-- Provisions the DB shape both modes can sit on while staying dormant
-- on the hybrid path. The legacy `video_locale_fulltext_search_idx`
-- from `0006_hybrid_search_gin/migration.sql` is intentionally untouched
-- — `searchVideoKeyword` (R4) keeps reading it.
--
-- Three pieces:
--   1. `pg_trgm` extension (idempotent; first migration that needs it).
--   2. Two STORED generated tsvector columns on `video_locale`:
--      `title_tsv` and `description_tsv`. They derive from the canonical
--      `title` / `description` columns; rewriting either canonical field
--      automatically refreshes its tsvector.
--   3. Two GIN indexes:
--      - `video_locale_lexical_weighted_idx` over the per-field weighted
--        tsvector `(setweight(title_tsv,'A') || setweight(description_tsv,'B'))`.
--        Backs the `searchByKeywordWeighted` retriever in keyword-first
--        mode. Title-tier weight (A) outranks description-tier weight (B)
--        so a query word that lands in the title beats the same word in
--        the description.
--      - `video_locale_title_trgm_idx` over `title` with `gin_trgm_ops`.
--        Backs the `searchByTrigram` retriever for typo-tolerant lookup.
--
-- Byte-parity invariant: the generated-column expressions and the
-- weighted GIN index expression below MUST stay byte-equal to the
-- corresponding `*_GENERATED_EXPR` and `WEIGHTED_TSV_INDEX_EXPR`
-- constants in `src/services/hybrid-search-sql.ts`. The planner only
-- matches expression-based GIN indexes when the query-side expression
-- is character-for-character identical to the indexed expression.
-- `hybrid-search-sql.test.ts` enforces this by reading this file at
-- test time.
--
-- The trigram path uses operator-class GIN (`gin_trgm_ops`) and does
-- NOT need a TS shared constant — operator-class indexes are selected
-- by the operator (`%>`) regardless of alias prefixes. Per
-- docs/solutions/best-practices/gin-byte-parity-trigram-vs-expression-indexes-20260429.md.
--
-- Generated-column drift trap: any future change to the
-- `*_GENERATED_EXPR` constants requires a coordinated
-- `DROP COLUMN ... CASCADE + ADD COLUMN ... GENERATED ALWAYS AS (...)`
-- migration. ALTER COLUMN cannot edit a generated expression in place.
-- Per docs/solutions/database-issues/postgres-generated-column-drift-add-column-if-not-exists-20260429.md.
--
-- Created non-CONCURRENTLY for the same reason as `0006_hybrid_search_gin`:
-- admin deploys against a near-empty corpus today and the AccessExclusiveLock
-- is acceptable. Future re-creations against a populated corpus should
-- use `CREATE INDEX CONCURRENTLY` in a `prisma:no_transaction` migration.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "video_locale"
  ADD COLUMN IF NOT EXISTS "title_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, ''))) STORED;

ALTER TABLE "video_locale"
  ADD COLUMN IF NOT EXISTS "description_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(description, ''))) STORED;

CREATE INDEX IF NOT EXISTS "video_locale_lexical_weighted_idx"
  ON "video_locale"
  USING GIN ((setweight(title_tsv, 'A') || setweight(description_tsv, 'B')));

CREATE INDEX IF NOT EXISTS "video_locale_title_trgm_idx"
  ON "video_locale"
  USING GIN (title gin_trgm_ops);

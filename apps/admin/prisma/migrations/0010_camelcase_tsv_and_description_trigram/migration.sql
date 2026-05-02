-- Recall fix for keyword-first search on CamelCased brand queries.
--
-- Two coordinated changes:
--   1. Rewrite the `video_locale.title_tsv` and `video_locale.description_tsv`
--      generated columns to inject a space at every camelCase boundary
--      BEFORE `to_tsvector` runs. `BibleProject` becomes `Bible Project`
--      and tokenizes as `bible` + `project`, so a user query like
--      `"the bible project"` (which `websearch_to_tsquery` parses as
--      `'the' & 'bible' & 'project'`, three separate tokens ANDed)
--      matches descriptions written with the joined-form brand. The
--      regex `([a-z])([A-Z])` is the conservative form: it preserves
--      all-caps acronyms like `YHWH` and `LORD` intact (admin has
--      videos with those titles), while still splitting two-segment
--      CamelCase like `BibleProject` / `JesusFilm` / `MacOS`.
--
--      Postgres has no in-place editor for stored generated expressions
--      (`ALTER COLUMN ... GENERATED` doesn't accept a new expression),
--      so the migration must DROP the columns CASCADE (which also drops
--      `video_locale_lexical_weighted_idx`, which referenced them) and
--      ADD them back with the new expression, then recreate the
--      weighted index. Per
--      docs/solutions/database-issues/postgres-generated-column-drift-add-column-if-not-exists-20260429.md.
--
--   2. Add a trigram GIN index on `video_locale.description` so the
--      keyword-first `searchByTrigram` retriever can also match the
--      description column. Trigrams ignore token boundaries entirely —
--      `bible project` 3-grams overlap `bibleproject` directly — which
--      is defense-in-depth beyond the CamelCase split for typos and
--      partial input. The existing `video_locale_title_trgm_idx` is
--      untouched.
--
-- Byte-parity invariant: the rewritten generated-column expressions
-- and the recreated weighted index expression MUST stay byte-equal to
-- the corresponding `*_GENERATED_EXPR` and `WEIGHTED_TSV_INDEX_EXPR`
-- constants in `src/services/hybrid-search-sql.ts`. The planner only
-- matches expression-based GIN indexes when the query-side expression
-- is character-for-character identical to the indexed expression.
-- `hybrid-search-sql.test.ts` enforces this by reading this file at
-- test time.
--
-- Hybrid mode: the legacy R4 `video_locale_fulltext_search_idx` from
-- `0006_hybrid_search_gin/migration.sql` is intentionally untouched.
-- That index is built over a separate expression on the raw `title` /
-- `description` columns (not on `*_tsv`), so its content is unchanged
-- by this migration. `searchVideoKeyword` (used by hybrid mode) keeps
-- reading it; `hybrid-search.regression.test.ts` enforces hybrid
-- byte-identity against deterministic mocked retrievers.
--
-- Created non-CONCURRENTLY for the same reason as 0006 / 0009: admin's
-- prod corpus is 0 rows today (R0 backfill not yet run) and the
-- AccessExclusiveLock is acceptable.

ALTER TABLE "video_locale" DROP COLUMN IF EXISTS "title_tsv" CASCADE;
ALTER TABLE "video_locale" DROP COLUMN IF EXISTS "description_tsv" CASCADE;

ALTER TABLE "video_locale"
  ADD COLUMN IF NOT EXISTS "title_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', regexp_replace(coalesce(title, ''), '([a-z])([A-Z])', '\1 \2', 'g'))) STORED;

ALTER TABLE "video_locale"
  ADD COLUMN IF NOT EXISTS "description_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', regexp_replace(coalesce(description, ''), '([a-z])([A-Z])', '\1 \2', 'g'))) STORED;

CREATE INDEX IF NOT EXISTS "video_locale_lexical_weighted_idx"
  ON "video_locale"
  USING GIN ((setweight(title_tsv, 'A') || setweight(description_tsv, 'B')));

CREATE INDEX IF NOT EXISTS "video_locale_description_trgm_idx"
  ON "video_locale"
  USING GIN (description gin_trgm_ops);

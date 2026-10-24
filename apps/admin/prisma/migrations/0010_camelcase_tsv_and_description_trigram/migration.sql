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
--      KNOWN LIMITATION (ASCII-only): POSIX bracket classes `[a-z]` /
--      `[A-Z]` match ONLY ASCII Latin characters. Cyrillic, Greek, or
--      accented-Latin CamelCase boundaries (e.g. `СловоБожие`) are
--      NOT split. JFP is multilingual; recall on those queries falls
--      through to the trigram retriever, which is locale-blind. A
--      future migration can broaden the regex to `[[:lower:]]` /
--      `[[:upper:]]` (Postgres POSIX classes that honor LC_CTYPE)
--      once the recall trade-off is benchmarked against real corpus
--      data — out of scope here.
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
--      SIZING REVISIT: pg_trgm GIN scales linearly with total characters
--      indexed; descriptions are typically 10-100x longer than titles,
--      so this index will be materially larger than the title trgm.
--      R4 originally avoided it on a populated corpus citing balloon
--      risk. Admin's prod is 0 rows today (R0 backfill not yet run),
--      so the cost is theoretical. Capture
--      `pg_relation_size('video_locale_description_trgm_idx')` once
--      R0 lands and revisit when it exceeds ~500 MB or when write
--      latency on `video_locale` INSERT/UPDATE regresses >20% — at
--      that point consider partial indexing on `WHERE
--      char_length(description) < N`, or fall back to title-only
--      trigram with a documented recall trade-off.
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
--
-- POST-R0 WARNING: the DROP COLUMN + ADD COLUMN GENERATED pattern
-- above takes AccessExclusiveLock on `video_locale` for the full
-- duration of the column rebuild. On a 0-row table that's instant;
-- on a hypothetical R0-backfilled table with 100k+ rows it's a full
-- table rewrite. Any future migration of this shape should be
-- staged out of the Prisma transaction (split DDL into pieces,
-- use `CREATE INDEX CONCURRENTLY` via raw psql, or use Prisma's
-- `Unsupported` escape hatch). Manually re-applying 0010 against a
-- populated table is destructive — Prisma's `_prisma_migrations`
-- ledger guards normal redeploys, but `migrate resolve --rolled-back`
-- on this migration is forbidden post-R0; treat fixes as
-- forward-only counter-migrations.

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

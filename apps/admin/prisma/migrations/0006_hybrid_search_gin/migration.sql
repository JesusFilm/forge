-- R4 hybrid-search GIN indexes for keyword retrieval.
--
-- Creates tsvector GIN indexes over `video_locale` (title + description)
-- and `experience_locale` (title + meta_description) so the R4
-- `HybridSearchService` keyword retrievers can match
-- `plainto_tsquery('simple', ?)` predicates via index scan rather than
-- sequential scan on the full per-locale corpus.
--
-- The tsvector expressions below MUST remain byte-equal to the
-- `*_INDEX_EXPR` constants in `src/services/hybrid-search-sql.ts`. The
-- planner only matches expression indexes when the query-side
-- expression is character-for-character identical to the indexed
-- expression (alias prefixes are normalized away, but whitespace,
-- quoting, and column order are not). Drift silently reverts the
-- retrievers to seq scan on large corpora. `hybrid-search-sql.test.ts`
-- enforces the byte-parity invariant by reading this file at test
-- time and asserting both constants appear verbatim.
--
-- `IF NOT EXISTS` keeps the migration idempotent across partial
-- retries. No schema changes are introduced — this migration is
-- index-only. Created non-CONCURRENTLY because R4 deploys against
-- corpora that are either empty (fresh admin environments) or small
-- enough that an AccessExclusiveLock is acceptable during the brief
-- index build. Future re-creations against a populated corpus should
-- use `CREATE INDEX CONCURRENTLY` in a `prisma:no_transaction`
-- migration — same precedent as the 0001_init HNSW partial index.

CREATE INDEX IF NOT EXISTS "video_locale_fulltext_search_idx"
  ON "video_locale"
  USING GIN (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '')));

CREATE INDEX IF NOT EXISTS "experience_locale_fulltext_search_idx"
  ON "experience_locale"
  USING GIN (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(meta_description, '')));

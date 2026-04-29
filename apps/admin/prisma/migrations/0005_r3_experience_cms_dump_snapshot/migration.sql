-- R3 experience content dump snapshot columns on `experience_locale`.
--
-- Populated by the experience-content-dump workflow
-- (`triggerExperienceContentDump`) when an admin ExperienceLocale row was
-- written from the cms Strapi v5 corpus. NULL for admin-native locales
-- (i.e. rows that never came through the dump).
--
-- Schema semantics:
--   - `cms_document_id` is Strapi v5's cross-locale + cross-publish-state
--     grouping key (the 24-char alphanumeric `documentId`). Stable across
--     draft/publish cycles AND across locales — all locales of a single
--     cms experience share this value. This is the match key the dump
--     service uses to group multiple admin ExperienceLocale rows into a
--     single canonical admin `Experience`.
--   - `cms_dumped_at` is the TIMESTAMPTZ when the last rerun of the dump
--     touched this row. Used for operational visibility and the rerun
--     idempotency guarantee (R3.12: unchanged cms + repeat rerun = only
--     this timestamp updates).
--   - `cms_content_hash` is SHA-256 (hex) of the canonical-JSON merge
--     payload the dump writes. Gates BOTH the merge-skip check on rerun
--     (R3.8) AND the `runExperienceEmbedding` re-dispatch check (R3.9).
--     Persisted ONLY after successful embedding dispatch so a dispatch
--     failure leaves the previous hash in place, forcing retry on the
--     next rerun. See plan Key Decision §6 and §12.
--
-- Partial index: Strapi v5 document ids are sparse (only populated for
-- dumped locales). A NULL-excluded partial index is the right shape for
-- the "find the admin row matching this cms document" lookup the dump
-- service issues on every target. Prisma does not model partial-index
-- WHERE clauses cleanly across providers, so the index lives here — same
-- pattern as 0001_init's `(updated_at DESC, created_at DESC) WHERE
-- deleted_at IS NULL` index on `video`.
--
-- These columns MUST NEVER be exposed via GraphQL. The Pothos field list
-- on `ExperienceLocale` (src/graphql/types/experience.ts) omits them by
-- construction; src/graphql/schema.test.ts asserts the absence at schema-
-- test time.
--
-- Non-nullable columns are not added by this migration — all three are
-- introduced as nullable so the migration is safe to apply in any order
-- relative to data migration. Populate happens on next dump-workflow
-- invocation.

ALTER TABLE "experience_locale"
  ADD COLUMN "cms_document_id"  TEXT,
  ADD COLUMN "cms_dumped_at"    TIMESTAMPTZ,
  ADD COLUMN "cms_content_hash" TEXT;

-- Created non-CONCURRENTLY because cms_document_id is added in this
-- same migration (line 45) and is NULL on every existing row by
-- definition — the partial index covers zero rows on creation
-- regardless of experience_locale's current row count. Same precedent
-- as 0001_init's `videos (updated_at DESC, created_at DESC) WHERE
-- deleted_at IS NULL` index. Future re-creations of this index AFTER
-- the dump has populated cms_document_id values must use
-- `CREATE INDEX CONCURRENTLY` in a `prisma:no_transaction` migration
-- to avoid an AccessExclusiveLock on a populated experience_locale.
CREATE INDEX "experience_locale_cms_document_id_idx"
  ON "experience_locale"("cms_document_id")
  WHERE "cms_document_id" IS NOT NULL;

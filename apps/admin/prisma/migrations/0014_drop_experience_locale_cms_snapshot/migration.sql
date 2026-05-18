-- Drop R3 dump-snapshot columns from `experience_locale`.
--
-- The columns were introduced in 0005_r3_experience_cms_dump_snapshot
-- to support the cms (Strapi v5) → admin experience-content-dump
-- workflow. Experiences now live in admin natively; the dump and its
-- supporting code surfaces were removed in the same plan as this
-- migration. See:
--
--   docs/plans/2026-05-17-001-refactor-decouple-experience-embeds-from-cms-plan.md
--
-- Forward-only. Verified safe to apply against admin's prod Postgres
-- on 2026-05-17 — `SELECT COUNT(*) FROM experience_locale` returned
-- 0 rows and the three cms_* counts were trivially 0 (the dump never
-- successfully ran in prod). Re-applying this migration against a
-- populated `experience_locale` table would still be safe at the
-- column-data level (drops are idempotent via IF EXISTS) but
-- AccessExclusiveLock briefly during the ALTER — acceptable because
-- the table is small.
--
-- This is the first admin migration to drop columns. A code-side
-- rollback to the immediately-prior commit on this branch is
-- functionally safe (this migration and the surrounding code
-- referencing the columns are co-versioned in the same PR). Rolling
-- back to an earlier commit that references the columns is unsafe —
-- the columns would be gone from the DB but expected by the code.
-- Coordinate a re-add in that case.

DROP INDEX IF EXISTS "experience_locale_cms_document_id_idx";

ALTER TABLE "experience_locale"
  DROP COLUMN IF EXISTS "cms_document_id",
  DROP COLUMN IF EXISTS "cms_dumped_at",
  DROP COLUMN IF EXISTS "cms_content_hash";

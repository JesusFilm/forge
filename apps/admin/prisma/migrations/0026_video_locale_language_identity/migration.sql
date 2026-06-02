-- Preserve Core localized video display text by stable language identity.
-- Existing BCP-47 rows keep their public lookup while gaining provenance,
-- freshness, and soft-delete lifecycle metadata.

ALTER TABLE "video_locale"
  ADD COLUMN "language_id" TEXT,
  ADD COLUMN "source" "SourceTier" NOT NULL DEFAULT 'core',
  ADD COLUMN "synced_at" TIMESTAMP(3),
  ADD COLUMN "deleted_at" TIMESTAMP(3);

UPDATE "video_locale" AS vl
SET "language_id" = l."id"
FROM "language" AS l
WHERE vl."language_id" IS NULL
  AND vl."locale" IS NOT NULL
  AND l."bcp47" = vl."locale";

UPDATE "video_locale"
SET "synced_at" = COALESCE("published_at", "updated_at", NOW())
WHERE "source" = 'core'
  AND "synced_at" IS NULL;

UPDATE "video_study_question" AS vsq
SET "language_id" = l."id"
FROM "language" AS l
WHERE vsq."language_id" IS NULL
  AND vsq."locale" IS NOT NULL
  AND l."bcp47" = vsq."locale";

-- Legacy JSON-map study-question rows were migrated before the sync
-- preserved Core's primary flag. Keep omitted-locale GraphQL reads backward
-- compatible until the localized metadata backfill refreshes each video.
UPDATE "video_study_question"
SET "primary" = TRUE
WHERE "source" = 'core'
  AND "deleted_at" IS NULL
  AND "primary" = FALSE
  AND ("locale" IS NULL OR "locale" = 'en');

ALTER TABLE "video_locale"
  ALTER COLUMN "locale" DROP NOT NULL;

ALTER TABLE "video_locale"
  ADD CONSTRAINT "video_locale_language_id_fkey"
  FOREIGN KEY ("language_id") REFERENCES "language"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "video_locale_video_id_language_id_key"
  ON "video_locale"("video_id", "language_id");

CREATE INDEX "video_locale_language_id_idx" ON "video_locale"("language_id");
CREATE INDEX "video_locale_deleted_at_idx" ON "video_locale"("deleted_at");

-- Keep the existing core_id uniqueness in this rollout so old sync code can
-- still run safely during deploy/rollback. Core currently returns distinct
-- localized study-question ids in the observed fixtures; if Core later reuses
-- ids across languages, ship that duplicate-capable identity as a separate
-- no-rollback migration with an explicit maintenance window.

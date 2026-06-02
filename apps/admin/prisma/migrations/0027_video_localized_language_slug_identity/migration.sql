-- Variant-aware localized watch content identity.
--
-- BCP-47 locale is a broad grouping/fallback key, not a unique language
-- variant identity. Store the public language slug and Core language id on
-- localized video rows so watch rendering can select an exact variant while
-- broad locale queries continue to work.

ALTER TABLE "video_locale"
  ADD COLUMN IF NOT EXISTS "language_slug" TEXT,
  ADD COLUMN IF NOT EXISTS "language_core_id" TEXT;

ALTER TABLE "video_study_question"
  ADD COLUMN IF NOT EXISTS "language_slug" TEXT,
  ADD COLUMN IF NOT EXISTS "language_core_id" TEXT;

UPDATE "video_locale" AS vl
SET
  "language_slug" = l."slug",
  "language_core_id" = l."core_id"
FROM "language" AS l
WHERE vl."language_id" = l."id";

UPDATE "video_study_question" AS vsq
SET
  "language_slug" = l."slug",
  "language_core_id" = l."core_id"
FROM "language" AS l
WHERE vsq."language_id" = l."id";

-- Locale is intentionally no longer unique per video. A single BCP-47 tag can
-- map to multiple Core/Admin language variants.
DROP INDEX IF EXISTS "video_locale_video_id_locale_key";

-- Localized Core questions are also language-aware. Do not rely on Core
-- question ids being globally unique across every localized row. Keep this
-- as a lookup index rather than a new uniqueness constraint so legacy duplicate
-- rows cannot block deploy-time migration.
DROP INDEX IF EXISTS "video_study_question_core_id_key";
DROP INDEX IF EXISTS "video_study_question_video_id_core_id_language_id_key";

CREATE INDEX IF NOT EXISTS "video_locale_video_id_locale_idx"
  ON "video_locale"("video_id", "locale");
CREATE INDEX IF NOT EXISTS "video_locale_language_slug_idx"
  ON "video_locale"("language_slug");
CREATE INDEX IF NOT EXISTS "video_locale_video_id_language_slug_idx"
  ON "video_locale"("video_id", "language_slug");
CREATE INDEX IF NOT EXISTS "video_locale_language_core_id_idx"
  ON "video_locale"("language_core_id");
CREATE INDEX IF NOT EXISTS "video_locale_locale_status_deleted_at_idx"
  ON "video_locale"("locale", "status", "deleted_at");

CREATE INDEX IF NOT EXISTS "video_study_question_language_slug_idx"
  ON "video_study_question"("language_slug");
CREATE INDEX IF NOT EXISTS "video_study_question_video_id_language_slug_idx"
  ON "video_study_question"("video_id", "language_slug");
CREATE INDEX IF NOT EXISTS "video_study_question_language_core_id_idx"
  ON "video_study_question"("language_core_id");
CREATE INDEX IF NOT EXISTS "video_study_question_video_id_locale_idx"
  ON "video_study_question"("video_id", "locale");
CREATE INDEX IF NOT EXISTS "video_study_question_locale_deleted_at_idx"
  ON "video_study_question"("locale", "deleted_at");
CREATE INDEX IF NOT EXISTS "video_study_question_video_id_core_id_language_id_idx"
  ON "video_study_question"("video_id", "core_id", "language_id");

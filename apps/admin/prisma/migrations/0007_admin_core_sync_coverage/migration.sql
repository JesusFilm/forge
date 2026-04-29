-- Expand admin's Core sync schema so Core-owned child entities can be
-- represented directly in admin-native models.

-- Language audio preview metadata (Core languages.audioPreview).
ALTER TABLE "language"
  ADD COLUMN "audio_preview_value" TEXT,
  ADD COLUMN "audio_preview_duration" INTEGER,
  ADD COLUMN "audio_preview_size" BIGINT,
  ADD COLUMN "audio_preview_bitrate" INTEGER,
  ADD COLUMN "audio_preview_codec" TEXT;

-- Country-language relation metadata and provenance.
ALTER TABLE "country_language"
  ADD COLUMN "core_id" TEXT,
  ADD COLUMN "source" "SourceTier" NOT NULL DEFAULT 'core',
  ADD COLUMN "display_speakers" TEXT,
  ADD COLUMN "primary" BOOLEAN DEFAULT false,
  ADD COLUMN "order" INTEGER,
  ADD COLUMN "synced_at" TIMESTAMPTZ,
  ADD COLUMN "deleted_at" TIMESTAMPTZ,
  ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "country_language_core_id_key"
  ON "country_language"("core_id");
CREATE INDEX "country_language_deleted_at_idx"
  ON "country_language"("deleted_at");

-- Core reference metadata.
ALTER TABLE "video_origin"
  ADD COLUMN "description" TEXT;

ALTER TABLE "bible_book"
  ADD COLUMN "osis_id" TEXT,
  ADD COLUMN "alternate_name" TEXT,
  ADD COLUMN "paratext_abbreviation" TEXT,
  ADD COLUMN "is_new_testament" BOOLEAN;

-- Canonical video publish timestamp from Core.
ALTER TABLE "video"
  ADD COLUMN "published_at" TIMESTAMPTZ;

-- Downloadable video dub renditions.
ALTER TABLE "video_dub_download"
  ADD COLUMN "core_id" TEXT,
  ADD COLUMN "source" "SourceTier" NOT NULL DEFAULT 'core',
  ADD COLUMN "bitrate" INTEGER,
  ADD COLUMN "synced_at" TIMESTAMPTZ,
  ADD COLUMN "deleted_at" TIMESTAMPTZ,
  ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "video_dub_download_core_id_key"
  ON "video_dub_download"("core_id");
CREATE INDEX "video_dub_download_deleted_at_idx"
  ON "video_dub_download"("deleted_at");

-- Subtitles are edition-aligned for timecodes, but Core also provides the
-- owning video and a localized text/value payload.
ALTER TABLE "video_subtitle"
  ADD COLUMN "video_id" TEXT,
  ADD COLUMN "value" TEXT,
  ADD COLUMN "primary" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "video_subtitle"
  ADD CONSTRAINT "video_subtitle_video_id_fkey"
  FOREIGN KEY ("video_id") REFERENCES "video"("id") ON DELETE CASCADE;

CREATE INDEX "video_subtitle_video_id_idx"
  ON "video_subtitle"("video_id");

-- Convert study questions from a JSON locale map to addressable per-locale
-- rows, matching ExperienceLocale/VideoLocale modeling.
ALTER TABLE "video_study_question"
  ADD COLUMN "locale" TEXT,
  ADD COLUMN "language_id" TEXT,
  ADD COLUMN "primary" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deleted_at" TIMESTAMPTZ;

ALTER TABLE "video_study_question"
  ALTER COLUMN "text" DROP DEFAULT;

ALTER TABLE "video_study_question"
  ALTER COLUMN "text" TYPE TEXT
  USING CASE
    WHEN jsonb_typeof("text") = 'object' THEN COALESCE("text"->>'en', "text"::TEXT)
    WHEN jsonb_typeof("text") = 'string' THEN trim(both '"' from "text"::TEXT)
    ELSE COALESCE("text"::TEXT, '')
  END;

ALTER TABLE "video_study_question"
  ALTER COLUMN "text" SET DEFAULT '';

ALTER TABLE "video_study_question"
  ADD CONSTRAINT "video_study_question_language_id_fkey"
  FOREIGN KEY ("language_id") REFERENCES "language"("id") ON DELETE SET NULL;

CREATE INDEX "video_study_question_language_id_idx"
  ON "video_study_question"("language_id");
CREATE INDEX "video_study_question_locale_idx"
  ON "video_study_question"("locale");
CREATE INDEX "video_study_question_deleted_at_idx"
  ON "video_study_question"("deleted_at");

-- Core image rendition metadata.
ALTER TABLE "video_image"
  ADD COLUMN "aspect_ratio" TEXT,
  ADD COLUMN "mobile_cinematic_high" TEXT,
  ADD COLUMN "mobile_cinematic_low" TEXT,
  ADD COLUMN "mobile_cinematic_very_low" TEXT,
  ADD COLUMN "thumbnail" TEXT,
  ADD COLUMN "video_still" TEXT,
  ADD COLUMN "deleted_at" TIMESTAMPTZ;

CREATE INDEX "video_image_deleted_at_idx"
  ON "video_image"("deleted_at");

-- Bible citation Core metadata and lifecycle.
ALTER TABLE "bible_citation"
  ADD COLUMN "osis_id" TEXT,
  ADD COLUMN "order" INTEGER,
  ADD COLUMN "deleted_at" TIMESTAMPTZ,
  ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "bible_citation_deleted_at_idx"
  ON "bible_citation"("deleted_at");

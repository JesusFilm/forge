-- Rename `video_variant` → `video_dub` (and `video_variant_download` → `video_dub_download`).
--
-- Rationale: Core API uses "video-variant" as a blanket term, but the
-- varying axis between rows is the audio language (dub), not the frames
-- or the encoding. Editor/agent vocabulary is "dub." Boundary translation
-- (`coreVariant → dub`) lives in the Core-sync transform layer, not at
-- the DB schema.
--
-- See the "what is a variant really?" discussion captured in the
-- Phase 2 PR thread and the updated data-model highlights in
-- apps/admin/CLAUDE.md.

-- Tables
ALTER TABLE "video_variant"          RENAME TO "video_dub";
ALTER TABLE "video_variant_download" RENAME TO "video_dub_download";

-- FK column on the download table
ALTER TABLE "video_dub_download"
    RENAME COLUMN "video_variant_id" TO "video_dub_id";

-- Foreign-key constraints
ALTER TABLE "video_dub"
    RENAME CONSTRAINT "video_variant_video_id_fkey"         TO "video_dub_video_id_fkey";
ALTER TABLE "video_dub"
    RENAME CONSTRAINT "video_variant_language_id_fkey"      TO "video_dub_language_id_fkey";
ALTER TABLE "video_dub"
    RENAME CONSTRAINT "video_variant_video_edition_id_fkey" TO "video_dub_video_edition_id_fkey";
ALTER TABLE "video_dub"
    RENAME CONSTRAINT "video_variant_mux_video_id_fkey"     TO "video_dub_mux_video_id_fkey";
ALTER TABLE "video_dub_download"
    RENAME CONSTRAINT "video_variant_download_video_variant_id_fkey"
                    TO "video_dub_download_video_dub_id_fkey";

-- Indexes + unique constraints
ALTER INDEX "video_variant_core_id_key"                     RENAME TO "video_dub_core_id_key";
ALTER INDEX "video_variant_video_id_idx"                    RENAME TO "video_dub_video_id_idx";
ALTER INDEX "video_variant_language_id_idx"                 RENAME TO "video_dub_language_id_idx";
ALTER INDEX "video_variant_video_edition_id_idx"            RENAME TO "video_dub_video_edition_id_idx";
ALTER INDEX "video_variant_mux_video_id_idx"                RENAME TO "video_dub_mux_video_id_idx";
ALTER INDEX "video_variant_deleted_at_idx"                  RENAME TO "video_dub_deleted_at_idx";
ALTER INDEX "video_variant_download_video_variant_id_idx"   RENAME TO "video_dub_download_video_dub_id_idx";

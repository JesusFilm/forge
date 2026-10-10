-- Image enrichment for admin media assets.
--
-- Keep storage/readiness (`media_asset.status`) separate from derived image
-- enrichment so uploaded images remain immediately usable while blur data and
-- localized title/alt metadata are generated in the background.

CREATE TYPE "MediaImageEnrichmentStatus" AS ENUM (
    'waiting',
    'processing',
    'complete',
    'failed',
    'skipped'
);

CREATE TYPE "MediaAssetLocaleStatus" AS ENUM (
    'waiting',
    'processing',
    'complete',
    'failed',
    'skipped'
);

ALTER TABLE "media_asset"
ADD COLUMN "blur_data_url" TEXT,
ADD COLUMN "dominant_color" TEXT,
ADD COLUMN "image_enrichment_status" "MediaImageEnrichmentStatus" NOT NULL DEFAULT 'waiting',
ADD COLUMN "image_enrichment_error_code" TEXT,
ADD COLUMN "image_enrichment_error_message" TEXT,
ADD COLUMN "image_enrichment_started_at" TIMESTAMPTZ,
ADD COLUMN "image_enrichment_completed_at" TIMESTAMPTZ;

CREATE TABLE "media_asset_locale" (
    "id" TEXT NOT NULL,
    "media_asset_id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT,
    "alt_text" TEXT,
    "title_source" "RevisedByKind",
    "alt_text_source" "RevisedByKind",
    "title_locked" BOOLEAN NOT NULL DEFAULT false,
    "alt_text_locked" BOOLEAN NOT NULL DEFAULT false,
    "status" "MediaAssetLocaleStatus" NOT NULL DEFAULT 'waiting',
    "error_code" TEXT,
    "error_message" TEXT,
    "generated_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "media_asset_locale_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "media_asset_locale_media_asset_id_locale_key"
ON "media_asset_locale"("media_asset_id", "locale");

CREATE INDEX "media_asset_locale_locale_idx"
ON "media_asset_locale"("locale");

CREATE INDEX "media_asset_locale_status_updated_at_idx"
ON "media_asset_locale"("status", "updated_at");

CREATE INDEX "media_asset_kind_image_enrichment_status_updated_at_idx"
ON "media_asset"("kind", "image_enrichment_status", "updated_at");

ALTER TABLE "media_asset_locale"
ADD CONSTRAINT "media_asset_locale_media_asset_id_fkey"
FOREIGN KEY ("media_asset_id") REFERENCES "media_asset"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

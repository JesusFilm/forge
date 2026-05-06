-- Localized image display names and alt text now live in media_asset_locale.
-- There is no production data for this feature slice, so no canonical media
-- text backfill is needed.

ALTER TABLE "media_asset"
DROP COLUMN IF EXISTS "description",
DROP COLUMN IF EXISTS "alt_text",
DROP COLUMN IF EXISTS "display_name";

ALTER TABLE "media_asset_locale"
DROP COLUMN IF EXISTS "title",
DROP COLUMN IF EXISTS "title_source",
DROP COLUMN IF EXISTS "title_locked",
ADD COLUMN "display_name" TEXT,
ADD COLUMN "display_name_source" "RevisedByKind",
ADD COLUMN "display_name_locked" BOOLEAN NOT NULL DEFAULT false;

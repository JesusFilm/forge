-- Add editor-owned Search and Social metadata to localized videos without
-- changing the Core-owned visible title, description, or image metadata.
-- Nullable columns keep this expansion compatible with old application builds.

SET lock_timeout = '5s';

ALTER TABLE "video_locale"
  ADD COLUMN "search_title" TEXT,
  ADD COLUMN "search_description" TEXT,
  ADD COLUMN "social_image_asset_id" TEXT;

CREATE INDEX "video_locale_social_image_asset_id_idx"
  ON "video_locale"("social_image_asset_id");

-- Add the constraint without validating historical rows while holding the
-- stronger ALTER TABLE lock. Validation uses a weaker lock afterward.
ALTER TABLE "video_locale"
  ADD CONSTRAINT "video_locale_social_image_asset_id_fkey"
  FOREIGN KEY ("social_image_asset_id") REFERENCES "media_asset"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "video_locale"
  VALIDATE CONSTRAINT "video_locale_social_image_asset_id_fkey";

RESET lock_timeout;

-- Initialize only the active English locale of the canonical JESUS film.
-- An absent row is safe during rolling deploys and fixture databases. More
-- than one candidate indicates corrupt/ambiguous identity and aborts before
-- any data changes. Deployment readiness separately requires exactly one row
-- in every target environment expected to contain JESUS.
DO $$
DECLARE
  candidate_count INTEGER;
  candidate_id TEXT;
  candidate_identities TEXT;
BEGIN
  SELECT
    COUNT(*),
    MIN(vl."id"),
    STRING_AGG(
      FORMAT(
        'video_locale=%s video=%s core_id=%s slug=%s language_core_id=%s',
        vl."id",
        v."id",
        v."core_id",
        v."slug",
        vl."language_core_id"
      ),
      '; ' ORDER BY vl."id"
    )
  INTO candidate_count, candidate_id, candidate_identities
  FROM "video_locale" AS vl
  INNER JOIN "video" AS v ON v."id" = vl."video_id"
  WHERE v."core_id" = '1_jf-0-0'
    AND v."slug" = 'jesus'
    AND v."deleted_at" IS NULL
    AND vl."language_core_id" = '529'
    AND vl."deleted_at" IS NULL;

  IF candidate_count > 1 THEN
    RAISE EXCEPTION
      '0047 ambiguous English JESUS VideoLocale candidates (%): %',
      candidate_count,
      candidate_identities;
  ELSIF candidate_count = 1 THEN
    UPDATE "video_locale"
    SET
      "search_title" = 'Watch JESUS — Full Movie Free Online | Jesus Film Project',
      "search_description" = 'Watch the JESUS film free online. Follow his life, teachings, miracles, death, and resurrection through the Gospel of Luke in more than 2,000 languages.',
      "social_image_asset_id" = NULL
    WHERE "id" = candidate_id;
  END IF;
END
$$;

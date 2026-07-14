ALTER TABLE "video_image"
  ADD COLUMN "blur_data_url" TEXT;

ALTER TABLE "video_image"
  DROP COLUMN IF EXISTS "blurhash";

-- Watch language inventories discover playable media by language before they
-- know the video id. Keep these language-leading indexes alongside the
-- video-leading Watch indexes used by individual video routes.

CREATE INDEX IF NOT EXISTS "video_dub_watch_inventory_language_idx"
  ON "video_dub"(
    "language_id",
    "video_id",
    "duration" DESC NULLS LAST,
    "updated_at" DESC,
    "id" ASC
  )
  INCLUDE ("video_edition_id")
  WHERE "language_id" IS NOT NULL
    AND "deleted_at" IS NULL
    AND "published" = true
    AND "hls" IS NOT NULL
    AND "hls" <> '';

CREATE INDEX IF NOT EXISTS "video_subtitle_watch_inventory_language_idx"
  ON "video_subtitle"(
    "language_id",
    "video_id",
    "video_edition_id"
  )
  WHERE "language_id" IS NOT NULL
    AND "deleted_at" IS NULL
    AND (
      ("vtt_src" IS NOT NULL AND "vtt_src" <> '')
      OR ("srt_src" IS NOT NULL AND "srt_src" <> '')
    );

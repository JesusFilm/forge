CREATE INDEX IF NOT EXISTS "video_dub_edition_deleted_video_idx"
  ON "video_dub"("video_edition_id", "deleted_at", "video_id");

CREATE INDEX IF NOT EXISTS "video_dub_language_deleted_video_idx"
  ON "video_dub"("language_id", "deleted_at", "video_id");

CREATE INDEX IF NOT EXISTS "video_subtitle_language_deleted_edition_idx"
  ON "video_subtitle"("language_id", "deleted_at", "video_edition_id");

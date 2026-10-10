-- Watch single-video GraphQL queries are latency-sensitive and repeatedly
-- resolve the same small set of public child relations. These partial indexes
-- cover the production query shapes observed in Datadog APM for
-- videoBySlug/watch route snapshots.

CREATE INDEX IF NOT EXISTS "video_dub_watch_playable_duration_idx"
  ON "video_dub"("video_id", "duration" DESC, "id" ASC)
  WHERE "deleted_at" IS NULL
    AND "published" = true
    AND "hls" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "video_dub_watch_playable_language_idx"
  ON "video_dub"("video_id", "language_id", "duration" DESC, "id" ASC)
  WHERE "deleted_at" IS NULL
    AND "published" = true
    AND "hls" IS NOT NULL
    AND "language_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "video_dub_watch_playable_mux_idx"
  ON "video_dub"("video_id", "mux_video_id", "duration" DESC, "id" ASC)
  WHERE "deleted_at" IS NULL
    AND "published" = true
    AND "hls" IS NOT NULL
    AND "mux_video_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "video_locale_watch_lookup_idx"
  ON "video_locale"("video_id", "locale", "status", "language_slug", "id")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "video_locale_watch_visibility_idx"
  ON "video_locale"("video_id", "status")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "video_relation_watch_children_order_idx"
  ON "video_relation"("parent_id", "order" ASC NULLS LAST, "created_at" ASC, "id" ASC);

CREATE INDEX IF NOT EXISTS "video_relation_watch_parents_order_idx"
  ON "video_relation"("child_id", "order" ASC NULLS LAST, "created_at" ASC, "id" ASC);

CREATE INDEX IF NOT EXISTS "video_image_watch_video_active_idx"
  ON "video_image"("video_id")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "video_study_question_watch_lookup_idx"
  ON "video_study_question"("video_id", "locale", "order" ASC, "language_slug" ASC, "id" ASC)
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "bible_citation_watch_video_active_idx"
  ON "bible_citation"("video_id", "order" ASC, "id" ASC)
  WHERE "deleted_at" IS NULL;

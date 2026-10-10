CREATE TABLE "watch_event" (
    "id" TEXT NOT NULL,
    "auth_subject" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "video_id" TEXT NOT NULL,
    "video_dub_id" TEXT,
    "language_id" TEXT,
    "position_seconds" INTEGER,
    "duration_seconds" INTEGER,
    "progress" DOUBLE PRECISION,
    "request_session_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watch_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "watch_event_auth_subject_occurred_at_idx" ON "watch_event"("auth_subject", "occurred_at");
CREATE INDEX "watch_event_video_id_occurred_at_idx" ON "watch_event"("video_id", "occurred_at");
CREATE INDEX "watch_event_video_dub_id_idx" ON "watch_event"("video_dub_id");
CREATE INDEX "watch_event_language_id_idx" ON "watch_event"("language_id");

ALTER TABLE "watch_event"
  ADD CONSTRAINT "watch_event_video_id_fkey"
  FOREIGN KEY ("video_id") REFERENCES "video"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "watch_event"
  ADD CONSTRAINT "watch_event_video_dub_id_fkey"
  FOREIGN KEY ("video_dub_id") REFERENCES "video_dub"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "watch_event"
  ADD CONSTRAINT "watch_event_language_id_fkey"
  FOREIGN KEY ("language_id") REFERENCES "language"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

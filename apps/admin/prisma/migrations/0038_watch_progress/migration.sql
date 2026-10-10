CREATE TABLE "watch_progress" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "video_id" TEXT NOT NULL,
  "language_slug" TEXT,
  "position_seconds" INTEGER NOT NULL,
  "duration_seconds" INTEGER NOT NULL,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "last_watched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "watch_progress_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "watch_progress_position_seconds_check" CHECK ("position_seconds" >= 0),
  CONSTRAINT "watch_progress_duration_seconds_check" CHECK ("duration_seconds" > 0)
);

ALTER TABLE "watch_progress"
  ADD CONSTRAINT "watch_progress_video_id_fkey"
  FOREIGN KEY ("video_id") REFERENCES "video"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "watch_progress_user_id_video_id_key"
  ON "watch_progress"("user_id", "video_id");

CREATE INDEX "watch_progress_user_id_last_watched_at_idx"
  ON "watch_progress"("user_id", "last_watched_at");

CREATE INDEX "watch_progress_video_id_idx"
  ON "watch_progress"("video_id");

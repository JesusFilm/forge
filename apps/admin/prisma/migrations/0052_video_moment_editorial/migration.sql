-- Human-reviewed story beats for the TV Explore panel (Video.moments).
-- Editorial content kept OUTSIDE the transcript-chunk machine lifecycle:
-- the embedding pipeline prunes/re-chunks/overwrites video_transcript_chunk,
-- so reviewed prose gets its own table that no pipeline writes. Loaded only
-- by the guarded apply-video-moment-sheet operator script; served EXCLUSIVELY
-- by the moments read when rows exist for (video, language).
--
-- language_slug is BCP-47 ("en"), matching video_transcript.language.

CREATE TABLE "video_moment_editorial" (
  "id" TEXT NOT NULL,
  "video_id" TEXT NOT NULL,
  "language_slug" TEXT NOT NULL,
  "beat_index" INTEGER NOT NULL,
  "start_seconds" DOUBLE PRECISION NOT NULL,
  "end_seconds" DOUBLE PRECISION,
  "summary" TEXT NOT NULL,
  "bible_verses" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "question" TEXT,
  "reviewed_by" TEXT NOT NULL,
  "reviewed_at" TIMESTAMP(3) NOT NULL,
  "source_model" TEXT,
  "source_transcript_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "video_moment_editorial_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "video_moment_editorial_beat_index_check" CHECK ("beat_index" >= 0),
  CONSTRAINT "video_moment_editorial_start_seconds_check" CHECK ("start_seconds" >= 0),
  CONSTRAINT "video_moment_editorial_end_after_start_check"
    CHECK ("end_seconds" IS NULL OR "end_seconds" >= "start_seconds"),
  CONSTRAINT "video_moment_editorial_summary_nonempty_check"
    CHECK (length(btrim("summary")) > 0),
  CONSTRAINT "video_moment_editorial_reviewed_by_nonempty_check"
    CHECK (length(btrim("reviewed_by")) > 0)
);

ALTER TABLE "video_moment_editorial"
  ADD CONSTRAINT "video_moment_editorial_video_id_fkey"
  FOREIGN KEY ("video_id") REFERENCES "video"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "video_moment_editorial_video_id_language_slug_beat_index_key"
  ON "video_moment_editorial"("video_id", "language_slug", "beat_index");

CREATE INDEX "video_moment_editorial_video_id_language_slug_idx"
  ON "video_moment_editorial"("video_id", "language_slug");

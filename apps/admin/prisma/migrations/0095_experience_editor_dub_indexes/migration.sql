-- The experience editor needs exact per-video playable-language counts plus
-- five newest distinct language choices without materializing full Dub rows.
-- These partial covering indexes keep both scans index-only and preserve the
-- stable updated-at/id ordering used by the bounded summary query.

-- Prisma applies migrations transactionally, so CREATE INDEX CONCURRENTLY is
-- not legal here. Bound lock acquisition instead of queuing indefinitely
-- behind Core sync writes; a failed deploy can retry the idempotent statements.
SET lock_timeout = '5s';
SET statement_timeout = '2min';

CREATE INDEX IF NOT EXISTS "video_dub_editor_active_video_language_updated_id_idx"
  ON "video_dub"(
    "video_id",
    "language_id",
    "updated_at" DESC NULLS LAST,
    "id" ASC
  )
  INCLUDE ("hls", "dash", "share")
  WHERE "deleted_at" IS NULL
    AND COALESCE(
      NULLIF(btrim("hls"), ''),
      NULLIF(btrim("dash"), ''),
      NULLIF(btrim("share"), '')
    ) IS NOT NULL;

CREATE INDEX IF NOT EXISTS "video_dub_editor_active_video_updated_id_idx"
  ON "video_dub"(
    "video_id",
    "updated_at" DESC NULLS LAST,
    "id" ASC
  )
  INCLUDE ("language_id", "hls", "dash", "share")
  WHERE "deleted_at" IS NULL
    AND COALESCE(
      NULLIF(btrim("hls"), ''),
      NULLIF(btrim("dash"), ''),
      NULLIF(btrim("share"), '')
    ) IS NOT NULL;

RESET lock_timeout;
RESET statement_timeout;

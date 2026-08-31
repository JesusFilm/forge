-- Repair databases that applied the original 0052 recommendation migration
-- before finalization_due_at and its recovery index were added to that file.
-- Both statements are additive and safe for databases created from the final
-- 0052 definition as well as restored snapshots with the earlier checksum.
ALTER TABLE "recommendation_playback_episode"
  ADD COLUMN IF NOT EXISTS "finalization_due_at" timestamptz;

CREATE INDEX IF NOT EXISTS "recommendation_episode_finalization_due_idx"
  ON "recommendation_playback_episode" ("finalization_due_at", "id")
  INCLUDE ("generation", "active_until", "expires_at")
  WHERE "finalization_due_at" IS NOT NULL;

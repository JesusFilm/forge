-- Per-platform view restriction, synced read-only from Core.
--
-- Core's Video.restrictViewPlatforms (Platform[]: "watch" | "arclight" |
-- "journeys") was never pulled into Forge's catalog sync, so a video
-- restricted from "watch" in Core still surfaced on Forge's public watch
-- experience. This column gives the core-sync phase somewhere to store it;
-- enforcement lives in application code (search-watchability.ts and the
-- public video resolvers), not in this migration.

ALTER TABLE "video"
  ADD COLUMN "restrict_view_platforms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

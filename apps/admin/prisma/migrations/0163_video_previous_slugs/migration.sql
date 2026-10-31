-- Former video slugs, synced read-only from Core's Video.previousSlugs
-- (JesusFilm/core#9976). Feeds the watch route manifest's redirect map so
-- renamed videos' old /watch URLs 301 to the current slug instead of 404ing.

ALTER TABLE "video"
  ADD COLUMN "previous_slugs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

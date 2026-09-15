-- Bound recent playback lookup by authorized session before joining facts.
-- CONCURRENTLY keeps production episode ingestion available during the build.
CREATE INDEX CONCURRENTLY "recommendation_episode_session_created_idx"
  ON "recommendation_playback_episode" ("session_digest", "created_at" DESC, "id" DESC);

-- Bound recent playback lookup by authorized session before joining facts.
-- Use transaction-compatible DDL and bound both waiting and the write-blocking
-- build. A timeout fails the deployment; inspect and resolve that failed Prisma
-- migration before retrying through the normal release flow.
SET lock_timeout = '2s';
SET statement_timeout = '15s';

CREATE INDEX IF NOT EXISTS "recommendation_episode_session_created_idx"
  ON "recommendation_playback_episode" ("session_digest", "created_at" DESC, "id" DESC);

RESET lock_timeout;
RESET statement_timeout;

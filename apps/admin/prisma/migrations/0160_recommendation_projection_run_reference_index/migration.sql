-- Generation retention checks for remaining workflow references and PostgreSQL
-- checks this SET NULL FK for every deleted generation, even with no matches.
-- A page of 100 generations must not scan the full workflow history 100 times.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE INDEX "recommendation_profile_projection_run_projection_idx"
  ON "recommendation_profile_projection_run"("projection_id");

COMMIT;

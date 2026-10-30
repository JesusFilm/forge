-- The UNIQUE constraint's separate backing index remains the access path for
-- (run_id, stage, ordinal). This DROP needs ACCESS EXCLUSIVE on the hot stage
-- table; fail promptly if the lock is not immediately available. Prisma's
-- migration transaction cannot use DROP INDEX CONCURRENTLY.
BEGIN;
SET LOCAL lock_timeout = '2s';
DROP INDEX "recommendation_candidate_stage_run_stage_idx";
COMMIT;

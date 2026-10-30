-- Stage expiry is enforced against the request root at write time. Retention
-- selects request roots and cascades through the run-leading unique index;
-- there is no standalone stage-expiry sweep. The index is not a constraint.
-- A normal Prisma migration cannot use DROP INDEX CONCURRENTLY, so refuse a
-- contended lock promptly and leave the index intact on failure.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
DROP INDEX "recommendation_candidate_stage_expiry_idx";
COMMIT;

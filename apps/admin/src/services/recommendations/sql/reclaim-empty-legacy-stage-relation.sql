-- INACTIVE PREPARATION ASSET: not a Prisma migration or deployment hook.
-- Promote only in a separately reviewed migration after the live retention,
-- compact-writer fleet, rollback-reader and capacity gates have passed.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '10s';
LOCK TABLE public.recommendation_candidate_stage_evidence IN ACCESS EXCLUSIVE MODE;
DO $reclamation$
BEGIN
  IF EXISTS (SELECT 1 FROM public.recommendation_candidate_stage_evidence LIMIT 1) THEN
    RAISE EXCEPTION 'Legacy candidate stage evidence remains; reclamation refused'
      USING ERRCODE = 'P0001';
  END IF;
END
$reclamation$;
-- Default RESTRICT semantics intentionally reject any new inbound foreign key.
TRUNCATE TABLE public.recommendation_candidate_stage_evidence;
COMMIT;

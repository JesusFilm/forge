-- Owner-authorized October 2 (NZDT) disposal of ALL remaining legacy stage
-- detail, including former quality/investigation holds. Compact payloads and
-- operational request/run/item records retain their original lifetimes.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '30s';

-- Serialize with old detail readers/writers. Contention aborts this transaction;
-- do not retry automatically or widen the target to dependent tables.
LOCK TABLE ONLY public.recommendation_candidate_stage_evidence
  IN ACCESS EXCLUSIVE MODE;

UPDATE public.recommendation_candidate_run
SET legacy_detail_retired_at = CURRENT_TIMESTAMP
WHERE trace_format_version IS NULL
  AND trace_payload IS NULL
  AND legacy_detail_retired_at IS NULL;

-- Retain the schema, indexes, dual reader, and compact-capable rollback image.
-- Ordinary DELETE would leave the large relation files allocated.
TRUNCATE TABLE ONLY public.recommendation_candidate_stage_evidence RESTRICT;
COMMIT;

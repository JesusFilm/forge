-- Additive state for intentionally retired legacy stage detail. Historical
-- issuance counters and the request/run expiry remain unchanged.
BEGIN;
SET LOCAL lock_timeout = '2s';

ALTER TABLE recommendation_candidate_run
  ADD COLUMN legacy_detail_retired_at timestamptz;

ALTER TABLE recommendation_candidate_run
  ADD CONSTRAINT recommendation_legacy_detail_retired_format_check CHECK (
    legacy_detail_retired_at IS NULL OR
    (trace_format_version IS NULL AND trace_payload IS NULL)
  ) NOT VALID;

-- One durable, aggregate-only receipt per finite manifest. No request, run,
-- viewer, or raw evidence identifier is stored here.
CREATE TABLE recommendation_legacy_detail_retirement_run (
  manifest_digest char(64) PRIMARY KEY,
  target_database_hash char(64) NOT NULL,
  manifest_created_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  converted_runs integer NOT NULL,
  retired_runs integer NOT NULL,
  stage_rows_deleted integer NOT NULL,
  encoded_bytes integer NOT NULL,
  CHECK (converted_runs >= 0 AND retired_runs >= 0 AND stage_rows_deleted >= 0 AND encoded_bytes >= 0)
);

-- Retired state must remain true even if an old writer is accidentally revived.
-- The parent row lock serializes this check with retirement's UPDATE.
CREATE FUNCTION reject_retired_recommendation_stage_write()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM recommendation_candidate_run c
    WHERE c.id = NEW.run_id AND c.legacy_detail_retired_at IS NOT NULL
    FOR SHARE
  ) THEN
    RAISE EXCEPTION 'legacy candidate detail has been retired';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER recommendation_stage_reject_retired_write
BEFORE INSERT OR UPDATE ON recommendation_candidate_stage_evidence
FOR EACH ROW EXECUTE FUNCTION reject_retired_recommendation_stage_write();

COMMIT;

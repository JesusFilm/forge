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
DECLARE
  retired_at timestamptz;
  format_version integer;
  has_payload boolean;
BEGIN
  -- Lock every parent, including one that is not yet retired. A writer racing
  -- the retirement UPDATE must re-read the committed state after that lock.
  SELECT c.legacy_detail_retired_at, c.trace_format_version,
    c.trace_payload IS NOT NULL
  INTO retired_at, format_version, has_payload
  FROM recommendation_candidate_run c
  WHERE c.id = NEW.run_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'candidate run unavailable for stage write';
  END IF;
  IF retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'legacy candidate detail has been retired';
  END IF;
  IF format_version IS NOT NULL OR has_payload THEN
    RAISE EXCEPTION 'compact candidate detail cannot accept stage rows';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER recommendation_stage_reject_retired_write
BEFORE INSERT OR UPDATE ON recommendation_candidate_stage_evidence
FOR EACH ROW EXECUTE FUNCTION reject_retired_recommendation_stage_write();

-- A retired marker is a one-way state. Prevent a later writer from clearing it
-- or manufacturing a compact payload on a run whose old detail was discarded.
CREATE FUNCTION reject_retired_recommendation_run_rewrite()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.legacy_detail_retired_at IS NOT NULL AND (
    NEW.legacy_detail_retired_at IS DISTINCT FROM OLD.legacy_detail_retired_at OR
    NEW.trace_format_version IS DISTINCT FROM OLD.trace_format_version OR
    NEW.trace_payload IS DISTINCT FROM OLD.trace_payload
  ) THEN
    RAISE EXCEPTION 'retired candidate trace state is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER recommendation_run_reject_retired_rewrite
BEFORE UPDATE ON recommendation_candidate_run
FOR EACH ROW EXECUTE FUNCTION reject_retired_recommendation_run_rewrite();

COMMIT;

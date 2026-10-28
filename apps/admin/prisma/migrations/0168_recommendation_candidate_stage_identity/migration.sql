-- History-only traces retain ordered opaque stage identities, not diagnostic JSON.
-- Legacy rows and version-one packed payloads remain untouched for bounded
-- reconciliation and rollback. The mode is opt-in only after dual readers ship.
BEGIN;
SET LOCAL lock_timeout = '2s';

ALTER TABLE recommendation_candidate_run
  ADD COLUMN stage_ids text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE FUNCTION valid_recommendation_candidate_stage_ids(ids text[])
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  candidate_id text;
  seen text[] := ARRAY[]::text[];
BEGIN
  IF cardinality(ids) > 448 THEN RETURN false; END IF;
  FOREACH candidate_id IN ARRAY ids LOOP
    IF candidate_id IS NULL OR length(candidate_id) NOT BETWEEN 1 AND 191
      OR candidate_id !~ '^[A-Za-z0-9][A-Za-z0-9:_./-]*$'
      OR candidate_id = ANY(seen) THEN RETURN false; END IF;
    seen := array_append(seen, candidate_id);
  END LOOP;
  RETURN true;
END;
$$;

ALTER TABLE recommendation_candidate_run
  DROP CONSTRAINT recommendation_candidate_trace_format_check,
  ADD CONSTRAINT recommendation_candidate_trace_format_check CHECK (
    valid_recommendation_candidate_stage_ids(stage_ids)
    AND (
      (trace_format_version IS NULL AND trace_payload IS NULL AND cardinality(stage_ids) = 0)
      OR (trace_format_version = 1 AND trace_payload IS NOT NULL
        AND cardinality(stage_ids) = 0
        AND valid_recommendation_candidate_trace_v1(trace_payload))
      OR (trace_format_version = 2 AND trace_payload IS NULL)
    )
  ) NOT VALID;

COMMENT ON COLUMN recommendation_candidate_run.stage_ids IS
  'Ordered, bounded opaque stage identities for history-only traces. Empty for legacy and packed traces; no diagnostic payload is retained.';
COMMIT;

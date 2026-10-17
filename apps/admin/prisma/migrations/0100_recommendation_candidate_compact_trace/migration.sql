-- Expand only. Existing 29-day stage rows remain readable until their roots expire.
-- Compact traces are opt-in at the application layer after a dual-format reader
-- has been deployed. The request -> run cascade already owns their lifetime.
BEGIN;
SET LOCAL lock_timeout = '2s';

ALTER TABLE "recommendation_candidate_run"
  ADD COLUMN "trace_format_version" integer,
  ADD COLUMN "trace_payload" jsonb;

-- This validator mirrors the former stage-table checks. Every field is
-- explicitly present, including nullable fields, so a missing value cannot
-- silently decode as NULL. Existing source JSON remains unconstrained beyond
-- its former array limit; the application also rejects non-finite numbers.
CREATE FUNCTION "valid_recommendation_candidate_trace_v1"(payload jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  observation jsonb;
  reason jsonb;
  field_name text;
  stage_name text;
  ordinal_number numeric;
  number_value numeric;
  seen_positions text[] := ARRAY[]::text[];
  seen_ids text[] := ARRAY[]::text[];
BEGIN
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(payload -> 'stages') IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(payload -> 'stages') > 448 THEN
    RETURN false;
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(payload)) <> 1 THEN
    RETURN false;
  END IF;

  FOR observation IN SELECT value FROM jsonb_array_elements(payload -> 'stages') AS entry(value) LOOP
    IF jsonb_typeof(observation) IS DISTINCT FROM 'object' THEN
      RETURN false;
    END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(observation)) <> 15 THEN
      RETURN false;
    END IF;
    FOREACH field_name IN ARRAY ARRAY[
      'id', 'stage', 'ordinal', 'candidateKey', 'targetMediaId',
      'sourceGenerator', 'sourceRank', 'sourceScore', 'normalizedScore',
      'rrfScore', 'deterministicScore', 'finalPosition', 'reasonCodes',
      'sourceEvidence', 'createdAt'
    ] LOOP
      IF NOT observation ? field_name THEN
        RETURN false;
      END IF;
    END LOOP;

    IF jsonb_typeof(observation -> 'id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(observation -> 'stage') IS DISTINCT FROM 'string'
      OR jsonb_typeof(observation -> 'candidateKey') IS DISTINCT FROM 'string'
      OR length(observation ->> 'candidateKey') > 191
      OR jsonb_typeof(observation -> 'createdAt') IS DISTINCT FROM 'string'
      OR (observation ->> 'createdAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' THEN
      RETURN false;
    END IF;
    IF (observation ->> 'id') = ANY(seen_ids) THEN
      RETURN false;
    END IF;
    seen_ids := array_append(seen_ids, observation ->> 'id');
    PERFORM (observation ->> 'createdAt')::timestamptz;

    stage_name := observation ->> 'stage';
    IF stage_name NOT IN (
      'nominated', 'canonicalized', 'deduplicated', 'rejected',
      'scored', 'ordered', 'composed'
    ) OR jsonb_typeof(observation -> 'ordinal') IS DISTINCT FROM 'number' THEN
      RETURN false;
    END IF;
    ordinal_number := (observation ->> 'ordinal')::numeric;
    IF ordinal_number < 0 OR ordinal_number > 63
      OR ordinal_number <> trunc(ordinal_number)
      OR (stage_name || ':' || ordinal_number::integer::text) = ANY(seen_positions) THEN
      RETURN false;
    END IF;
    seen_positions := array_append(seen_positions, stage_name || ':' || ordinal_number::integer::text);

    FOREACH field_name IN ARRAY ARRAY['targetMediaId', 'sourceGenerator'] LOOP
      IF jsonb_typeof(observation -> field_name) NOT IN ('null', 'string') THEN
        RETURN false;
      END IF;
    END LOOP;
    IF jsonb_typeof(observation -> 'targetMediaId') = 'string'
      AND length(observation ->> 'targetMediaId') > 191 THEN
      RETURN false;
    END IF;
    IF jsonb_typeof(observation -> 'sourceGenerator') = 'string'
      AND length(observation ->> 'sourceGenerator') > 64 THEN
      RETURN false;
    END IF;

    FOREACH field_name IN ARRAY ARRAY[
      'sourceRank', 'sourceScore', 'normalizedScore', 'rrfScore',
      'deterministicScore', 'finalPosition'
    ] LOOP
      IF jsonb_typeof(observation -> field_name) NOT IN ('null', 'number') THEN
        RETURN false;
      END IF;
      IF jsonb_typeof(observation -> field_name) = 'number' THEN
        number_value := (observation ->> field_name)::numeric;
        IF (field_name = 'sourceRank' AND
              (number_value < 1 OR number_value > 64 OR number_value <> trunc(number_value)))
          OR (field_name = 'sourceScore' AND
              (number_value < -1 OR number_value > 1))
          OR (field_name IN ('normalizedScore', 'rrfScore', 'deterministicScore') AND
              (number_value < 0 OR number_value > 1))
          OR (field_name = 'finalPosition' AND
              (number_value < 0 OR number_value > 63 OR number_value <> trunc(number_value))) THEN
          RETURN false;
        END IF;
      END IF;
    END LOOP;

    IF jsonb_typeof(observation -> 'reasonCodes') IS DISTINCT FROM 'array'
      OR jsonb_typeof(observation -> 'sourceEvidence') IS DISTINCT FROM 'array' THEN
      RETURN false;
    END IF;
    IF jsonb_array_length(observation -> 'reasonCodes') > 16
      OR jsonb_array_length(observation -> 'sourceEvidence') > 16 THEN
      RETURN false;
    END IF;
    FOR reason IN SELECT value FROM jsonb_array_elements(observation -> 'reasonCodes') AS entry(value) LOOP
      IF jsonb_typeof(reason) IS DISTINCT FROM 'string' THEN
        RETURN false;
      END IF;
    END LOOP;
  END LOOP;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format
  OR datetime_field_overflow OR numeric_value_out_of_range THEN
  RETURN false;
END;
$$;

ALTER TABLE "recommendation_candidate_run"
  ADD CONSTRAINT "recommendation_candidate_trace_format_check" CHECK (
    ("trace_format_version" IS NULL AND "trace_payload" IS NULL)
    OR ("trace_format_version" IS NOT NULL AND "trace_format_version" = 1
      AND "trace_payload" IS NOT NULL
      AND "valid_recommendation_candidate_trace_v1"("trace_payload"))
  ) NOT VALID;

COMMENT ON COLUMN "recommendation_candidate_run"."trace_payload" IS
  'Versioned, complete 29-day candidate-stage observations. NULL means legacy stage rows; request-root deletion cascades through this run.';
COMMIT;

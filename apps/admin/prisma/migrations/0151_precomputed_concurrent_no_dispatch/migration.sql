-- Admit only the second sealed, late-committed reservation. Retain the first
-- incident and all immutability / same-account maintenance fencing from 0150.
SET lock_timeout = '1000ms';
SET statement_timeout = '15000ms';
BEGIN;

DO $$
DECLARE item record; removed integer := 0;
BEGIN
  -- PostgreSQL truncates generated check names; resolve the five column checks
  -- through their exact table/column identities instead of guessing those names.
  FOR item IN
    SELECT c.conname FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.conrelid = 'recommendation_precomputed_edge_no_dispatch_disposition'::regclass
      AND c.contype = 'c' AND cardinality(c.conkey) = 1
      AND a.attname IN ('call_id', 'original_attempt_id', 'request_digest', 'evidence_digest', 'original_members')
  LOOP
    EXECUTE format('ALTER TABLE recommendation_precomputed_edge_no_dispatch_disposition DROP CONSTRAINT %I', item.conname);
    removed := removed + 1;
  END LOOP;
  IF removed <> 5 THEN RAISE EXCEPTION 'Unexpected no-dispatch constraint shape'; END IF;
END;
$$;

ALTER TABLE recommendation_precomputed_edge_no_dispatch_disposition
  ADD CONSTRAINT precomputed_no_dispatch_reviewed_incident CHECK (
    (call_id = 'f6cdb507-e7e3-4172-b31f-27ace231f2c3'
      AND original_attempt_id = '93be0f68-3564-4da7-a81d-0d7bb4b79212'
      AND request_digest = 'dd72735e1bcdb439f39a824dbdfe37c408af7e414ff8a095cdf5c549e1dd5437'
      AND evidence_digest = '43cdc25082e85c9b2a743a62da0dfc2857ce7b037d52a4467818dbf9a1e9422d'
      AND jsonb_array_length(original_members) = 1)
    OR
    (call_id = 'd541c707-abd6-4f01-9a8f-038c11b2a4e7'
      AND original_attempt_id = 'b01b7bb1-5b87-4630-baca-7640e76cfd62'
      AND request_digest = '72ef38c5db10293ad056e13a7de10e37995b9e6d54e614766a5ae2008fd242af'
      AND evidence_digest = 'ff0f204b63dbc2ccd51e60d8225cc714c2d6c2aa82d0a866d506bb44384d1c92'
      AND jsonb_array_length(original_members) = 2)
  ),
  ADD CONSTRAINT precomputed_no_dispatch_members_bound CHECK (
    jsonb_typeof(original_members) = 'array' AND octet_length(original_members::text) <= 8192
  );

CREATE OR REPLACE FUNCTION precomputed_edge_no_dispatch_complete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM recommendation_precomputed_edge_no_dispatch_disposition d
    WHERE d.generation_id = NEW.generation_id AND d.call_id = NEW.call_id) AND (
    (SELECT count(*) FROM recommendation_precomputed_edge_batch_member m
      WHERE m.generation_id = NEW.generation_id AND m.call_id = NEW.call_id) <> jsonb_array_length(NEW.original_members) OR EXISTS (
      SELECT 1 FROM recommendation_precomputed_edge_batch_member m
      WHERE m.generation_id = NEW.generation_id AND m.call_id = NEW.call_id
        AND m.application_state <> 'no_dispatch_unapplied'
    )) THEN RAISE EXCEPTION 'No-dispatch audit requires all member transitions'; END IF;
  RETURN NULL;
END;
$$;

COMMIT;
RESET lock_timeout;
RESET statement_timeout;

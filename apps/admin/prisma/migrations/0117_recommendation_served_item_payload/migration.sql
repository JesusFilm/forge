BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

ALTER TABLE recommendation_request
  ADD COLUMN served_item_payload jsonb;

CREATE FUNCTION recommendation_served_payload_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.served_item_payload IS NOT NULL
    AND NEW.served_item_payload IS DISTINCT FROM OLD.served_item_payload THEN
    RAISE EXCEPTION 'Served item payload is immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER recommendation_served_payload_immutable_check
BEFORE UPDATE OF served_item_payload ON recommendation_request
FOR EACH ROW EXECUTE FUNCTION recommendation_served_payload_immutable();

-- A deferred check permits Prisma's parent-first nested create, then verifies
-- the complete child set at commit. Legacy requests have a NULL payload.
CREATE FUNCTION recommendation_served_payload_check_request(checked_request_id text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  root recommendation_request%ROWTYPE;
  item_count integer;
  valid_count integer;
  payload_count integer;
BEGIN
  SELECT * INTO root FROM recommendation_request WHERE id = checked_request_id;
  IF NOT FOUND OR root.served_item_payload IS NULL THEN
    RETURN;
  END IF;
  IF jsonb_typeof(root.served_item_payload) IS DISTINCT FROM 'object'
    OR root.served_item_payload -> 'version' IS DISTINCT FROM '1'::jsonb
    OR jsonb_typeof(root.served_item_payload -> 'items') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Unsupported served item payload';
  END IF;
  SELECT count(*) INTO payload_count
    FROM jsonb_object_keys(root.served_item_payload -> 'items');
  SELECT count(*), count(*) FILTER (WHERE
      item.presentation = '{}'::jsonb
      AND item.candidate_provenance = '{}'::jsonb
      AND item.expires_at = root.expires_at
      AND jsonb_typeof(root.served_item_payload -> 'items' -> item.id -> 'presentation') = 'object'
      AND jsonb_typeof(root.served_item_payload -> 'items' -> item.id -> 'candidateProvenance') = 'object'
    ) INTO item_count, valid_count
    FROM recommendation_served_item item WHERE item.request_id = root.id;
  IF item_count <> payload_count OR item_count <> valid_count
    OR item_count <> root.expected_item_count THEN
    RAISE EXCEPTION 'Incomplete served item payload';
  END IF;
END $$;

CREATE FUNCTION recommendation_served_payload_integrity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'recommendation_request' THEN
    PERFORM recommendation_served_payload_check_request(NEW.id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM recommendation_served_payload_check_request(OLD.request_id);
  ELSE
    PERFORM recommendation_served_payload_check_request(NEW.request_id);
    IF TG_OP = 'UPDATE' AND OLD.request_id IS DISTINCT FROM NEW.request_id THEN
      PERFORM recommendation_served_payload_check_request(OLD.request_id);
    END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER recommendation_served_payload_request_check
AFTER INSERT OR UPDATE OF served_item_payload, expected_item_count, expires_at
ON recommendation_request DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION recommendation_served_payload_integrity();

CREATE CONSTRAINT TRIGGER recommendation_served_payload_item_check
AFTER INSERT OR UPDATE OR DELETE ON recommendation_served_item
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION recommendation_served_payload_integrity();

COMMIT;

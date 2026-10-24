-- Preserve the reviewed reservation and its pending member snapshot without
-- fabricating provider usage or weakening pending-source uniqueness.
SET lock_timeout = '1000ms';
SET statement_timeout = '15000ms';
BEGIN;

CREATE TABLE recommendation_precomputed_edge_no_dispatch_disposition (
  generation_id text NOT NULL CHECK (generation_id = 'production-astra-catalog-20261013-v6'),
  call_id uuid NOT NULL CHECK (call_id = 'f6cdb507-e7e3-4172-b31f-27ace231f2c3'),
  original_attempt_id uuid NOT NULL CHECK (original_attempt_id = '93be0f68-3564-4da7-a81d-0d7bb4b79212'),
  maintenance_attempt_id uuid NOT NULL CHECK (maintenance_attempt_id <> original_attempt_id),
  request_digest char(64) NOT NULL CHECK (request_digest = 'dd72735e1bcdb439f39a824dbdfe37c408af7e414ff8a095cdf5c549e1dd5437'),
  evidence_digest char(64) NOT NULL CHECK (evidence_digest = '43cdc25082e85c9b2a743a62da0dfc2857ce7b037d52a4467818dbf9a1e9422d'),
  operator_account_ref text NOT NULL CHECK (char_length(operator_account_ref) BETWEEN 8 AND 128),
  reason text NOT NULL CHECK (reason = 'reservation_timeout_before_dispatch'),
  acknowledged_at timestamp(3) NOT NULL,
  old_process_exited_attested boolean NOT NULL CHECK (old_process_exited_attested),
  original_members jsonb NOT NULL CHECK (jsonb_typeof(original_members) = 'array' AND jsonb_array_length(original_members) = 1 AND octet_length(original_members::text) <= 8192),
  member_snapshot_digest char(64) NOT NULL CHECK (member_snapshot_digest = encode(sha256(convert_to(original_members::text, 'UTF8')), 'hex')),
  PRIMARY KEY (generation_id, call_id),
  FOREIGN KEY (generation_id, call_id) REFERENCES recommendation_precomputed_edge_batch_call(generation_id, call_id) ON DELETE CASCADE
);

ALTER TABLE recommendation_precomputed_edge_batch_member
  DROP CONSTRAINT recommendation_precomputed_edge_batch_member_application_state_check,
  ADD CONSTRAINT recommendation_precomputed_edge_batch_member_application_state_check
    CHECK (application_state IN ('pending','acknowledged_unknown','no_dispatch_unapplied',
      'applied_edges','applied_empty','stale_unapplied','rejected_unapplied'));

CREATE FUNCTION precomputed_edge_no_dispatch_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE snapshot jsonb;
BEGIN
  IF TG_TABLE_NAME = 'recommendation_precomputed_edge_no_dispatch_disposition' THEN
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'No-dispatch evidence is immutable';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM recommendation_precomputed_edge_batch_call c
      JOIN recommendation_precomputed_execution_attempt a ON a.generation_id = c.generation_id AND a.attempt_id = c.attempt_id
      WHERE c.generation_id = NEW.generation_id AND c.call_id = NEW.call_id
        AND c.attempt_id = NEW.original_attempt_id AND c.request_digest = NEW.request_digest
        AND c.status = 'pending' AND c.finished_at IS NULL AND c.output_digest IS NULL
        AND c.input_tokens IS NULL AND c.output_tokens IS NULL AND c.cached_input_tokens IS NULL
        AND c.receipt_digest IS NULL AND c.error_code IS NULL AND c.recovery_replacement_call_id IS NULL
        AND a.ended_at IS NOT NULL AND a.end_reason = 'paused' AND a.account_ref = NEW.operator_account_ref
    ) THEN RAISE EXCEPTION 'No-dispatch reservation differs'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM recommendation_precomputed_execution_attempt a
      WHERE a.generation_id = NEW.generation_id AND a.attempt_id = NEW.maintenance_attempt_id
        AND a.ended_at IS NULL AND a.account_ref = NEW.operator_account_ref
        AND a.invocation = 'resume' AND a.backend = 'codex_chatgpt_subscription'
        AND a.billing_basis = 'included_subscription' AND a.model_id = 'gpt-6-astra'
    ) OR EXISTS (
      SELECT 1 FROM recommendation_precomputed_build_source s WHERE s.generation_id = NEW.generation_id
        AND s.lease_expires_at > now()
    ) THEN RAISE EXCEPTION 'No-dispatch maintenance fence differs'; END IF;
    SELECT jsonb_agg(to_jsonb(m) ORDER BY m.source_video_id) INTO snapshot
      FROM recommendation_precomputed_edge_batch_member m
      WHERE m.generation_id = NEW.generation_id AND m.call_id = NEW.call_id;
    IF snapshot IS DISTINCT FROM NEW.original_members OR EXISTS (
      SELECT 1 FROM recommendation_precomputed_edge_batch_member m
      WHERE m.generation_id = NEW.generation_id AND m.call_id = NEW.call_id
        AND (m.application_state <> 'pending' OR m.applied_revision IS NOT NULL OR m.result_choice_count IS NOT NULL)
    ) THEN RAISE EXCEPTION 'No-dispatch member evidence differs'; END IF;
  ELSIF TG_TABLE_NAME = 'recommendation_precomputed_edge_batch_call' THEN
    IF EXISTS (SELECT 1 FROM recommendation_precomputed_edge_no_dispatch_disposition d
      WHERE d.generation_id = OLD.generation_id AND d.call_id = OLD.call_id)
    THEN RAISE EXCEPTION 'No-dispatch reservation is immutable'; END IF;
  ELSE
    IF TG_OP = 'INSERT' THEN
      IF NEW.application_state = 'no_dispatch_unapplied' OR EXISTS (
        SELECT 1 FROM recommendation_precomputed_edge_no_dispatch_disposition d
        WHERE d.generation_id = NEW.generation_id AND d.call_id = NEW.call_id
      ) THEN
        RAISE EXCEPTION 'No-dispatch requires an audited pending transition';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.application_state = 'no_dispatch_unapplied' THEN
      RAISE EXCEPTION 'No-dispatch member is immutable';
    END IF;
    IF NEW.application_state = 'no_dispatch_unapplied' OR EXISTS (
      SELECT 1 FROM recommendation_precomputed_edge_no_dispatch_disposition d
      WHERE d.generation_id = OLD.generation_id AND d.call_id = OLD.call_id
    ) THEN
      IF OLD.application_state <> 'pending' OR NEW.application_state <> 'no_dispatch_unapplied'
        OR (to_jsonb(NEW) - 'application_state') IS DISTINCT FROM (to_jsonb(OLD) - 'application_state')
        OR NOT EXISTS (SELECT 1 FROM recommendation_precomputed_edge_no_dispatch_disposition d
          WHERE d.generation_id = OLD.generation_id AND d.call_id = OLD.call_id)
      THEN RAISE EXCEPTION 'No-dispatch transition differs'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER precomputed_edge_no_dispatch_audit_guard BEFORE INSERT OR UPDATE
  ON recommendation_precomputed_edge_no_dispatch_disposition FOR EACH ROW EXECUTE FUNCTION precomputed_edge_no_dispatch_guard();
CREATE TRIGGER precomputed_edge_no_dispatch_call_guard BEFORE UPDATE
  ON recommendation_precomputed_edge_batch_call FOR EACH ROW EXECUTE FUNCTION precomputed_edge_no_dispatch_guard();
CREATE TRIGGER precomputed_edge_no_dispatch_member_guard BEFORE INSERT OR UPDATE
  ON recommendation_precomputed_edge_batch_member FOR EACH ROW EXECUTE FUNCTION precomputed_edge_no_dispatch_guard();

-- The audit and its one authorized member transition must commit together.
CREATE FUNCTION precomputed_edge_no_dispatch_complete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM recommendation_precomputed_edge_no_dispatch_disposition d
    WHERE d.generation_id = NEW.generation_id AND d.call_id = NEW.call_id) AND (
    (SELECT count(*) FROM recommendation_precomputed_edge_batch_member m
      WHERE m.generation_id = NEW.generation_id AND m.call_id = NEW.call_id) <> 1 OR EXISTS (
      SELECT 1 FROM recommendation_precomputed_edge_batch_member m
      WHERE m.generation_id = NEW.generation_id AND m.call_id = NEW.call_id
        AND m.application_state <> 'no_dispatch_unapplied'
    )) THEN RAISE EXCEPTION 'No-dispatch audit requires its member transition'; END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER precomputed_edge_no_dispatch_complete_guard
  AFTER INSERT ON recommendation_precomputed_edge_no_dispatch_disposition
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION precomputed_edge_no_dispatch_complete();

COMMIT;
RESET lock_timeout;
RESET statement_timeout;

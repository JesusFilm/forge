-- Preserve the unresolved physical call while permitting exactly one audited
-- replacement for that call. The original usage and receipt remain unknown.
SET lock_timeout = '1000ms';
SET statement_timeout = '15000ms';
BEGIN;

ALTER TABLE recommendation_precomputed_edge_batch_call
  ADD COLUMN recovery_replacement_call_id uuid,
  ADD COLUMN recovery_operator_account_ref text,
  ADD COLUMN recovery_acknowledged_at timestamp(3),
  ADD COLUMN recovery_old_process_exited_attested boolean,
  ADD CONSTRAINT precomputed_edge_recovery_ack_check CHECK (
    (recovery_replacement_call_id IS NULL AND recovery_operator_account_ref IS NULL AND
      recovery_acknowledged_at IS NULL AND recovery_old_process_exited_attested IS NULL)
    OR (recovery_replacement_call_id IS NOT NULL AND recovery_replacement_call_id <> call_id AND
      recovery_operator_account_ref IS NOT NULL AND
      char_length(recovery_operator_account_ref) BETWEEN 8 AND 128 AND
      recovery_acknowledged_at IS NOT NULL AND recovery_old_process_exited_attested IS TRUE AND
      status = 'pending' AND finished_at IS NULL AND input_tokens IS NULL AND
      output_tokens IS NULL AND cached_input_tokens IS NULL AND receipt_digest IS NULL)
  );
CREATE UNIQUE INDEX precomputed_edge_recovery_replacement_idx
  ON recommendation_precomputed_edge_batch_call(generation_id)
  WHERE recovery_replacement_call_id IS NOT NULL;

DO $$
DECLARE old_name text;
BEGIN
  SELECT conname INTO STRICT old_name
  FROM pg_constraint
  WHERE conrelid = 'recommendation_precomputed_edge_batch_member'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%application_state%'
    AND pg_get_constraintdef(oid) LIKE '%stale_unapplied%';
  EXECUTE format('ALTER TABLE recommendation_precomputed_edge_batch_member DROP CONSTRAINT %I', old_name);
END;
$$;
ALTER TABLE recommendation_precomputed_edge_batch_member
  ADD CONSTRAINT recommendation_precomputed_edge_batch_member_application_state_check
  CHECK (application_state IN ('pending','acknowledged_unknown','applied_edges',
    'applied_empty','stale_unapplied','rejected_unapplied'));

CREATE FUNCTION precomputed_edge_recovery_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'recommendation_precomputed_edge_batch_call' THEN
    IF OLD.recovery_replacement_call_id IS NOT NULL THEN
      RAISE EXCEPTION 'Acknowledged unresolved edge call is immutable';
    END IF;
  ELSIF TG_TABLE_NAME = 'recommendation_precomputed_edge_batch_member' THEN
    IF OLD.application_state = 'acknowledged_unknown' THEN
      RAISE EXCEPTION 'Acknowledged unresolved edge member is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER precomputed_edge_recovery_call_immutable
  BEFORE UPDATE ON recommendation_precomputed_edge_batch_call
  FOR EACH ROW EXECUTE FUNCTION precomputed_edge_recovery_immutable();
CREATE TRIGGER precomputed_edge_recovery_member_immutable
  BEFORE UPDATE ON recommendation_precomputed_edge_batch_member
  FOR EACH ROW EXECUTE FUNCTION precomputed_edge_recovery_immutable();

COMMIT;
RESET lock_timeout;
RESET statement_timeout;

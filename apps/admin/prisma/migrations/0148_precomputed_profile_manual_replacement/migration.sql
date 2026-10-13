-- One explicitly authorized replacement per profile. Physical call receipts
-- remain immutable; this authorization expires only with retained call rows.
SET lock_timeout = '1000ms';
SET statement_timeout = '15000ms';
BEGIN;

CREATE TABLE recommendation_precomputed_profile_manual_replacement (
  generation_id text NOT NULL,
  cache_key char(64) NOT NULL,
  original_call_id uuid NOT NULL,
  replacement_call_id uuid NOT NULL,
  original_receipt_digest char(64) NOT NULL,
  attempt_id uuid NOT NULL,
  account_ref text NOT NULL CHECK (length(account_ref) BETWEEN 8 AND 128),
  authorized_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (generation_id, cache_key),
  UNIQUE (generation_id, original_call_id),
  UNIQUE (generation_id, replacement_call_id),
  CHECK (original_call_id <> replacement_call_id),
  FOREIGN KEY (generation_id, original_call_id)
    REFERENCES recommendation_precomputed_profile_call(generation_id, call_id) ON DELETE CASCADE,
  FOREIGN KEY (generation_id, replacement_call_id)
    REFERENCES recommendation_precomputed_profile_call(generation_id, call_id) ON DELETE CASCADE,
  FOREIGN KEY (generation_id, attempt_id)
    REFERENCES recommendation_precomputed_execution_attempt(generation_id, attempt_id) ON DELETE RESTRICT
);

CREATE FUNCTION reject_precomputed_profile_replacement_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Manual profile replacement authorizations are immutable';
END;
$$;
CREATE TRIGGER precomputed_profile_replacement_immutable
  BEFORE UPDATE ON recommendation_precomputed_profile_manual_replacement
  FOR EACH ROW EXECUTE FUNCTION reject_precomputed_profile_replacement_update();

COMMIT;
RESET lock_timeout;
RESET statement_timeout;

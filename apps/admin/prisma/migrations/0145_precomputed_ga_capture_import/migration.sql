-- Destination-owned verified GA capture import. The row has no generation FK
-- so an interrupted copy remains discoverable after generation retirement.
SET lock_timeout = '1000ms';
SET statement_timeout = '15000ms';
BEGIN;

CREATE TABLE recommendation_precomputed_ga_capture_import (
  destination_generation_id text PRIMARY KEY,
  destination_identity jsonb NOT NULL CHECK (jsonb_typeof(destination_identity) = 'object' AND octet_length(destination_identity::text) <= 4096),
  prepared_digest char(64) NOT NULL,
  origin_generation_id text,
  origin_identity jsonb CHECK (origin_identity IS NULL OR (jsonb_typeof(origin_identity) = 'object' AND octet_length(origin_identity::text) <= 4096)),
  origin_proof_digest char(64),
  copy_request_digest char(64),
  copy_attempt_id uuid,
  artifact_sha256 char(64),
  artifact_bytes bigint CHECK (artifact_bytes IS NULL OR artifact_bytes BETWEEN 13 AND 268435456),
  storage_key varchar(300),
  state text NOT NULL CHECK (state IN ('prepared','copying','bound','abandoned')),
  copy_claim_id uuid,
  copy_claim_epoch integer NOT NULL DEFAULT 0 CHECK (copy_claim_epoch >= 0),
  copy_lease_expires_at timestamp(3),
  temp_reserved_bytes bigint NOT NULL DEFAULT 0 CHECK (temp_reserved_bytes >= 0),
  staging_deadline_at timestamp(3),
  confirmed_at timestamp(3),
  bound_at timestamp(3),
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_cleanup_at timestamp(3),
  cleaned_at timestamp(3),
  CHECK ((state = 'prepared' AND origin_generation_id IS NULL AND origin_identity IS NULL AND
    origin_proof_digest IS NULL AND copy_request_digest IS NULL AND copy_attempt_id IS NULL AND
    artifact_sha256 IS NULL AND artifact_bytes IS NULL AND storage_key IS NULL AND
    copy_claim_id IS NULL AND copy_claim_epoch = 0 AND copy_lease_expires_at IS NULL AND
    temp_reserved_bytes = 0 AND staging_deadline_at IS NULL AND confirmed_at IS NULL AND bound_at IS NULL)
    OR (state <> 'prepared' AND origin_generation_id IS NOT NULL AND origin_identity IS NOT NULL AND
    origin_proof_digest IS NOT NULL AND copy_request_digest IS NOT NULL AND copy_attempt_id IS NOT NULL AND
    artifact_sha256 IS NOT NULL AND artifact_bytes IS NOT NULL AND storage_key IS NOT NULL AND
    staging_deadline_at IS NOT NULL)),
  CHECK ((state = 'copying' AND copy_claim_id IS NOT NULL AND copy_lease_expires_at IS NOT NULL AND
    temp_reserved_bytes = 2 * artifact_bytes AND confirmed_at IS NULL AND bound_at IS NULL)
    OR (state <> 'copying' AND copy_lease_expires_at IS NULL)),
  CHECK ((state = 'bound' AND confirmed_at IS NOT NULL AND bound_at IS NOT NULL AND temp_reserved_bytes = 0)
    OR (state <> 'bound' AND bound_at IS NULL)),
  CHECK (cleaned_at IS NULL OR state = 'abandoned')
);
CREATE INDEX precomputed_ga_import_state_deadline_idx
  ON recommendation_precomputed_ga_capture_import(state, staging_deadline_at);
CREATE INDEX precomputed_ga_import_origin_state_idx
  ON recommendation_precomputed_ga_capture_import(origin_generation_id, state);

COMMIT;
RESET lock_timeout;
RESET statement_timeout;

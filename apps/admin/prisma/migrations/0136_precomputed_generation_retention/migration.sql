-- Retention authority for a required rollback generation. The newest two
-- complete generations and fixed-test references are protected by the reader.
SET lock_timeout = '1000ms';
SET statement_timeout = '15000ms';
ALTER TABLE recommendation_precomputed_generation
  ADD COLUMN rollback_retention_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN retiring_at timestamp(3);
ALTER TABLE recommendation_precomputed_generation
  DROP CONSTRAINT recommendation_precomputed_generation_status_check,
  DROP CONSTRAINT recommendation_precomputed_generation_terminal_check;
ALTER TABLE recommendation_precomputed_generation
  ADD CONSTRAINT recommendation_precomputed_generation_status_check
  CHECK (status IN ('incomplete', 'capacity_blocked', 'failed', 'cancelled', 'complete', 'retiring')),
  ADD CONSTRAINT recommendation_precomputed_generation_terminal_check
  CHECK (
    (status IN ('incomplete', 'capacity_blocked') AND completed_at IS NULL AND failed_at IS NULL AND cancelled_at IS NULL AND retiring_at IS NULL) OR
    (status = 'complete' AND completed_at IS NOT NULL AND failed_at IS NULL AND cancelled_at IS NULL AND retiring_at IS NULL) OR
    (status = 'failed' AND failed_at IS NOT NULL AND completed_at IS NULL AND cancelled_at IS NULL AND retiring_at IS NULL) OR
    (status = 'cancelled' AND cancelled_at IS NOT NULL AND completed_at IS NULL AND failed_at IS NULL AND retiring_at IS NULL) OR
    (status = 'retiring' AND retiring_at IS NOT NULL AND num_nonnulls(completed_at, failed_at, cancelled_at) = 1)
  ),
  ADD CONSTRAINT recommendation_precomputed_retiring_hold_check
  CHECK (status <> 'retiring' OR rollback_retention_hold = false);
CREATE TABLE recommendation_precomputed_generation_retention_proof (
  generation_id text PRIMARY KEY,
  generation_protocol_version integer NOT NULL CHECK (generation_protocol_version IN (1, 2)),
  input_cutoff timestamp(3) NOT NULL,
  input_digest char(64) NOT NULL CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  input_mode text NOT NULL,
  state text NOT NULL CHECK (state = 'retired'),
  recorded_at timestamp(3) NOT NULL,
  expires_at timestamp(3) NOT NULL,
  CHECK (expires_at > recorded_at)
);
CREATE INDEX precomputed_retention_proof_expiry_idx
  ON recommendation_precomputed_generation_retention_proof (expires_at, generation_id);
RESET lock_timeout;
RESET statement_timeout;

-- Durable private catalog builds; no public serving pointer or activation.
SET lock_timeout = '1000ms';
SET statement_timeout = '15000ms';
BEGIN;

ALTER TABLE recommendation_precomputed_generation
  ADD COLUMN protocol_version integer NOT NULL DEFAULT 1,
  ADD COLUMN manifest_committed_at timestamp(3),
  ADD COLUMN capacity_preflight jsonb,
  ADD COLUMN historical_qualification jsonb,
  ADD COLUMN historical_qualification_digest char(64),
  ADD COLUMN cancelled_at timestamp(3);
ALTER TABLE recommendation_precomputed_generation
  DROP CONSTRAINT recommendation_precomputed_generation_status_check;
ALTER TABLE recommendation_precomputed_generation
  ADD CONSTRAINT recommendation_precomputed_generation_status_check
  CHECK (status IN ('incomplete', 'capacity_blocked', 'failed', 'cancelled', 'complete')),
  ADD CONSTRAINT recommendation_precomputed_generation_protocol_check
  CHECK (protocol_version IN (1, 2)),
  ADD CONSTRAINT recommendation_precomputed_generation_capacity_check
  CHECK (capacity_preflight IS NULL OR jsonb_typeof(capacity_preflight) = 'object'),
  ADD CONSTRAINT precomputed_gen_history_qualification_check
  CHECK (historical_qualification IS NULL OR jsonb_typeof(historical_qualification) = 'object'),
  ADD CONSTRAINT precomputed_gen_history_qualification_digest_check
  CHECK (historical_qualification_digest IS NULL OR historical_qualification_digest ~ '^[a-f0-9]{64}$');
-- The original 0128 check was unnamed by Prisma migration SQL; PostgreSQL
-- assigns this exact name when the table is created.
ALTER TABLE recommendation_precomputed_generation
  DROP CONSTRAINT recommendation_precomputed_generation_check;
ALTER TABLE recommendation_precomputed_generation
  ADD CONSTRAINT recommendation_precomputed_generation_terminal_check
  CHECK (
    (status IN ('incomplete', 'capacity_blocked') AND completed_at IS NULL AND failed_at IS NULL AND cancelled_at IS NULL) OR
    (status = 'complete' AND completed_at IS NOT NULL AND failed_at IS NULL AND cancelled_at IS NULL) OR
    (status = 'failed' AND failed_at IS NOT NULL AND completed_at IS NULL AND cancelled_at IS NULL) OR
    (status = 'cancelled' AND cancelled_at IS NOT NULL AND completed_at IS NULL AND failed_at IS NULL)
  );

ALTER TABLE recommendation_precomputed_model_call
  ADD COLUMN cost_usd numeric(18,9),
  ADD COLUMN reservation_lease_token uuid,
  ADD COLUMN receipt_digest char(64),
  ADD COLUMN receipt_checkpoint_applied boolean,
  ADD COLUMN receipt_applied_revision integer;
ALTER TABLE recommendation_precomputed_model_call
  ALTER COLUMN finished_at DROP NOT NULL;
ALTER TABLE recommendation_precomputed_model_call
  DROP CONSTRAINT recommendation_precomputed_model_call_status_check,
  DROP CONSTRAINT recommendation_precomputed_model_call_check,
  DROP CONSTRAINT recommendation_precomputed_model_call_check1;
ALTER TABLE recommendation_precomputed_model_call
  ADD CONSTRAINT recommendation_precomputed_model_call_status_check
  CHECK (status IN ('pending', 'succeeded', 'failed')),
  ADD CONSTRAINT recommendation_precomputed_model_call_cost_check
  CHECK (cost_usd IS NULL OR cost_usd >= 0),
  ADD CONSTRAINT recommendation_precomputed_model_call_revision_check
  CHECK (receipt_applied_revision IS NULL OR receipt_applied_revision >= 0),
  ADD CONSTRAINT recommendation_precomputed_model_call_time_check
  CHECK (finished_at IS NULL OR finished_at >= started_at),
  ADD CONSTRAINT recommendation_precomputed_model_call_outcome_check
  CHECK (
    (status = 'pending' AND finished_at IS NULL AND output_digest IS NULL AND error_code IS NULL) OR
    (status = 'succeeded' AND finished_at IS NOT NULL AND output_digest IS NOT NULL AND error_code IS NULL) OR
    (status = 'failed' AND finished_at IS NOT NULL AND output_digest IS NULL AND error_code IS NOT NULL)
  );

CREATE TABLE recommendation_precomputed_build_source (
  generation_id text NOT NULL REFERENCES recommendation_precomputed_generation(id) ON DELETE CASCADE,
  source_video_id text NOT NULL REFERENCES video(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'claimed', 'complete_edges', 'complete_empty', 'failed')),
  claim_id text,
  lease_token uuid,
  lease_expires_at timestamp(3),
  attempt_number integer NOT NULL DEFAULT 0 CHECK (attempt_number >= 0),
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(checkpoint) = 'object' AND pg_column_size(checkpoint) <= 16384),
  historical_provenance jsonb CHECK (historical_provenance IS NULL OR (jsonb_typeof(historical_provenance) = 'object' AND pg_column_size(historical_provenance) <= 4096)),
  checkpoint_revision integer NOT NULL DEFAULT 0 CHECK (checkpoint_revision >= 0),
  checkpoint_id text,
  checkpoint_digest text CHECK (checkpoint_digest IS NULL OR checkpoint_digest ~ '^[a-f0-9]{64}$'),
  failure_code text,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamp(3),
  PRIMARY KEY (generation_id, source_video_id),
  CHECK ((state = 'claimed' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL) OR (state <> 'claimed' AND lease_token IS NULL AND lease_expires_at IS NULL)),
  CHECK ((state = 'failed' AND failure_code IS NOT NULL) OR (state <> 'failed' AND failure_code IS NULL))
);
CREATE INDEX recommendation_precomputed_build_source_state_idx
  ON recommendation_precomputed_build_source (generation_id, state);

CREATE TABLE recommendation_precomputed_build_choice (
  generation_id text NOT NULL,
  source_video_id text NOT NULL,
  target_video_id text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND pg_column_size(payload) <= 8192),
  submission_digest char(64) NOT NULL CHECK (submission_digest ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY (generation_id, source_video_id, target_video_id),
  FOREIGN KEY (generation_id, source_video_id)
    REFERENCES recommendation_precomputed_build_source(generation_id, source_video_id) ON DELETE CASCADE
);

CREATE TABLE recommendation_precomputed_history_call (
  generation_id text NOT NULL REFERENCES recommendation_precomputed_generation(id) ON DELETE CASCADE,
  call_id text NOT NULL,
  source_video_id text,
  stage text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  request_digest char(64) NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  bytes_processed bigint CHECK (bytes_processed IS NULL OR bytes_processed >= 0),
  cost_usd numeric(18,9) CHECK (cost_usd IS NULL OR cost_usd >= 0),
  receipt_digest char(64) CHECK (receipt_digest IS NULL OR receipt_digest ~ '^[a-f0-9]{64}$'),
  error_code text,
  started_at timestamp(3) NOT NULL,
  finished_at timestamp(3),
  PRIMARY KEY (generation_id, call_id),
  CHECK ((status = 'pending' AND finished_at IS NULL AND error_code IS NULL) OR
         (status = 'succeeded' AND finished_at IS NOT NULL AND error_code IS NULL) OR
         (status = 'failed' AND finished_at IS NOT NULL AND error_code IS NOT NULL))
);

CREATE TABLE recommendation_precomputed_build_budget (
  generation_id text PRIMARY KEY REFERENCES recommendation_precomputed_generation(id) ON DELETE CASCADE,
  consumed_bytes bigint NOT NULL DEFAULT 0 CHECK (consumed_bytes >= 0)
);

COMMIT;
RESET lock_timeout;
RESET statement_timeout;

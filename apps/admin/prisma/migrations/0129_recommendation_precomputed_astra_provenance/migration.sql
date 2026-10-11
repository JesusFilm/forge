-- Private source-build provenance. No public recommendation pointer or visit data.
SET lock_timeout = '1000ms';
SET statement_timeout = '15000ms';
BEGIN;

ALTER TABLE recommendation_precomputed_generation
  ADD COLUMN input_mode text NOT NULL DEFAULT 'fixture',
  ADD COLUMN input_snapshot_mode text NOT NULL DEFAULT 'fixture',
  ADD COLUMN failure_code text;
ALTER TABLE recommendation_precomputed_generation
  ADD CONSTRAINT recommendation_precomputed_generation_input_mode_check
  CHECK (input_mode IN ('fixture', 'content_only')),
  ADD CONSTRAINT recommendation_precomputed_generation_snapshot_mode_check
  CHECK (input_snapshot_mode IN ('fixture', 'observed_fenced', 'preflight_failed'));

ALTER TABLE recommendation_precomputed_source
  ADD COLUMN status text NOT NULL DEFAULT 'complete',
  ADD COLUMN failure_code text;
ALTER TABLE recommendation_precomputed_source
  ADD CONSTRAINT recommendation_precomputed_source_status_check
  CHECK (status IN ('complete', 'failed')),
  ADD CONSTRAINT recommendation_precomputed_source_outcome_check
  CHECK (
    (status = 'complete' AND failure_code IS NULL) OR
    (status = 'failed' AND failure_code IS NOT NULL AND accepted_count = 0 AND payload = '[]'::jsonb)
  );

CREATE TABLE recommendation_precomputed_model_call (
  generation_id text NOT NULL REFERENCES recommendation_precomputed_generation(id) ON DELETE CASCADE,
  call_id text NOT NULL,
  source_video_id text NOT NULL,
  stage text NOT NULL,
  status text NOT NULL CHECK (status IN ('succeeded', 'failed')),
  model_id text NOT NULL,
  input_digest text NOT NULL CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  output_digest text CHECK (output_digest IS NULL OR output_digest ~ '^[a-f0-9]{64}$'),
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cached_input_tokens integer CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  error_code text,
  started_at timestamp(3) NOT NULL,
  finished_at timestamp(3) NOT NULL,
  PRIMARY KEY (generation_id, call_id),
  CHECK (finished_at >= started_at),
  CHECK (
    (status = 'succeeded' AND output_digest IS NOT NULL AND error_code IS NULL) OR
    (status = 'failed' AND output_digest IS NULL AND error_code IS NOT NULL)
  )
);
CREATE INDEX recommendation_precomputed_model_call_source_idx
  ON recommendation_precomputed_model_call (generation_id, source_video_id);

COMMIT;
RESET lock_timeout;
RESET statement_timeout;

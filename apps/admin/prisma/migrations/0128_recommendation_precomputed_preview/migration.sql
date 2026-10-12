-- Private, default-off build state. No recommendation serving pointer is added.
SET lock_timeout = '1000ms';
SET statement_timeout = '15000ms';
BEGIN;

CREATE TABLE recommendation_precomputed_generation (
  id text PRIMARY KEY,
  model_id text NOT NULL,
  prompt_version text NOT NULL,
  input_digest text NOT NULL CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  source_set_digest text NOT NULL CHECK (source_set_digest ~ '^[a-f0-9]{64}$'),
  input_cutoff timestamp(3) NOT NULL,
  expected_source_count integer NOT NULL CHECK (expected_source_count >= 0),
  status text NOT NULL DEFAULT 'incomplete' CHECK (status IN ('incomplete', 'failed', 'complete')),
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamp(3),
  failed_at timestamp(3),
  CHECK (
    (status = 'incomplete' AND completed_at IS NULL AND failed_at IS NULL) OR
    (status = 'complete' AND completed_at IS NOT NULL AND failed_at IS NULL) OR
    (status = 'failed' AND failed_at IS NOT NULL AND completed_at IS NULL)
  )
);
CREATE INDEX recommendation_precomputed_generation_created_at_idx
  ON recommendation_precomputed_generation (created_at DESC);

CREATE TABLE recommendation_precomputed_source (
  generation_id text NOT NULL REFERENCES recommendation_precomputed_generation(id) ON DELETE CASCADE,
  source_video_id text NOT NULL REFERENCES video(id) ON DELETE RESTRICT,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'array'),
  submission_digest text NOT NULL CHECK (submission_digest ~ '^[a-f0-9]{64}$'),
  accepted_count integer NOT NULL CHECK (accepted_count >= 0),
  PRIMARY KEY (generation_id, source_video_id),
  CHECK (accepted_count = jsonb_array_length(payload))
);

COMMIT;
RESET lock_timeout;
RESET statement_timeout;

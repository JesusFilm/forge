-- One observed usage receipt per shared physical edge invocation, with bounded
-- source-specific members. No prompt, full transcript, credential, or raw event.
SET lock_timeout = '1000ms';
SET statement_timeout = '15000ms';
BEGIN;

ALTER TABLE recommendation_precomputed_build_source
  ADD COLUMN edge_source_candidate_count integer,
  ADD COLUMN edge_source_candidate_digest char(64),
  ADD COLUMN edge_source_profile_key char(64),
  ADD COLUMN edge_candidate_pool_digest char(64),
  ADD COLUMN edge_historical_ref_digest char(64),
  ADD CONSTRAINT precomputed_build_source_edge_pool_check CHECK (
    (edge_source_candidate_count IS NULL AND edge_source_candidate_digest IS NULL AND
      edge_source_profile_key IS NULL AND edge_candidate_pool_digest IS NULL AND
      edge_historical_ref_digest IS NULL)
    OR (edge_source_candidate_count BETWEEN 0 AND 128 AND edge_source_candidate_digest IS NOT NULL AND
      edge_source_profile_key IS NOT NULL AND edge_candidate_pool_digest IS NOT NULL AND
      edge_historical_ref_digest IS NOT NULL)
  );

CREATE TABLE recommendation_precomputed_edge_batch_call (
  generation_id text NOT NULL REFERENCES recommendation_precomputed_generation(id) ON DELETE CASCADE,
  call_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  model_id text NOT NULL CHECK (model_id = 'gpt-6-astra'),
  backend text NOT NULL CHECK (backend = 'codex_chatgpt_subscription'),
  prompt_version text NOT NULL,
  schema_version text NOT NULL,
  input_digest char(64) NOT NULL,
  membership_digest char(64) NOT NULL,
  selected_corpus_digest char(64) NOT NULL,
  candidate_pool_digest char(64) NOT NULL,
  capture_ref_digest char(64),
  span_offer_digest char(64) NOT NULL,
  span_offers jsonb NOT NULL CHECK (jsonb_typeof(span_offers) = 'array' AND
    jsonb_array_length(span_offers) <= 64 AND octet_length(span_offers::text) <= 32768),
  request_digest char(64) NOT NULL,
  started_at timestamp(3) NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','succeeded','rejected','failed')),
  output_digest char(64),
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens > 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cached_input_tokens integer CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  error_code text,
  finished_at timestamp(3),
  receipt_digest char(64),
  PRIMARY KEY (generation_id, call_id),
  CONSTRAINT precomputed_edge_batch_call_attempt_fk FOREIGN KEY (generation_id, attempt_id)
    REFERENCES recommendation_precomputed_execution_attempt(generation_id, attempt_id) ON DELETE RESTRICT,
  CHECK ((status = 'pending' AND finished_at IS NULL AND input_tokens IS NULL AND
      output_tokens IS NULL AND cached_input_tokens IS NULL AND receipt_digest IS NULL AND
      output_digest IS NULL)
    OR (status <> 'pending' AND finished_at IS NOT NULL AND input_tokens IS NOT NULL AND
      output_tokens IS NOT NULL AND receipt_digest IS NOT NULL)),
  CHECK (status <> 'succeeded' OR (output_digest IS NOT NULL AND error_code IS NULL))
);

CREATE TABLE recommendation_precomputed_edge_batch_member (
  generation_id text NOT NULL,
  call_id uuid NOT NULL,
  source_video_id text NOT NULL,
  lease_token uuid NOT NULL,
  checkpoint_revision integer NOT NULL CHECK (checkpoint_revision >= 0),
  page_index integer NOT NULL CHECK (page_index BETWEEN 0 AND 127),
  source_profile_key char(64) NOT NULL,
  candidates jsonb NOT NULL CHECK (jsonb_typeof(candidates) = 'array' AND
    jsonb_array_length(candidates) BETWEEN 1 AND 8 AND
    octet_length(candidates::text) <= 8192),
  candidate_page_digest char(64) NOT NULL,
  source_candidate_count integer NOT NULL CHECK (source_candidate_count BETWEEN 1 AND 128),
  source_candidate_digest char(64) NOT NULL,
  historical_ref_digest char(64) NOT NULL,
  application_state text NOT NULL CHECK (application_state IN
    ('pending','applied_edges','applied_empty','stale_unapplied','rejected_unapplied')),
  applied_revision integer,
  result_choice_count integer CHECK (result_choice_count IS NULL OR result_choice_count BETWEEN 0 AND 8),
  PRIMARY KEY (generation_id, call_id, source_video_id),
  CONSTRAINT precomputed_edge_batch_member_call_fk FOREIGN KEY (generation_id, call_id)
    REFERENCES recommendation_precomputed_edge_batch_call(generation_id, call_id) ON DELETE RESTRICT,
  CONSTRAINT precomputed_edge_batch_member_source_fk FOREIGN KEY (generation_id, source_video_id)
    REFERENCES recommendation_precomputed_build_source(generation_id, source_video_id) ON DELETE RESTRICT,
  CONSTRAINT precomputed_edge_batch_member_profile_fk FOREIGN KEY (generation_id, source_profile_key)
    REFERENCES recommendation_precomputed_content_profile(generation_id, cache_key) ON DELETE RESTRICT,
  CHECK ((application_state IN ('applied_edges','applied_empty') AND applied_revision IS NOT NULL)
    OR (application_state NOT IN ('applied_edges','applied_empty') AND applied_revision IS NULL))
);
CREATE INDEX precomputed_edge_batch_member_source_idx
  ON recommendation_precomputed_edge_batch_member(generation_id, source_video_id, page_index, call_id);
CREATE UNIQUE INDEX precomputed_edge_batch_member_pending_source_idx
  ON recommendation_precomputed_edge_batch_member(generation_id, source_video_id)
  WHERE application_state = 'pending';

COMMIT;
RESET lock_timeout;
RESET statement_timeout;

-- Compact generation-scoped content profiles and one physical invocation per receipt.
SET lock_timeout = '1000ms';
SET statement_timeout = '15000ms';
BEGIN;

ALTER TABLE recommendation_precomputed_generation
  DROP CONSTRAINT recommendation_precomputed_generation_protocol_check,
  ADD CONSTRAINT recommendation_precomputed_generation_protocol_check
    CHECK (protocol_version IN (1, 2, 3, 4));
ALTER TABLE recommendation_precomputed_generation_retention_proof
  DROP CONSTRAINT precomputed_retention_protocol_check,
  ADD CONSTRAINT precomputed_retention_protocol_check
    CHECK (generation_protocol_version IN (1, 2, 3, 4));

CREATE TABLE recommendation_precomputed_content_profile (
  generation_id text NOT NULL REFERENCES recommendation_precomputed_generation(id) ON DELETE CASCADE,
  cache_key char(64) NOT NULL,
  video_id text NOT NULL REFERENCES video(id) ON DELETE RESTRICT,
  model_id text NOT NULL,
  backend text NOT NULL CHECK (backend = 'codex_chatgpt_subscription'),
  prompt_version text NOT NULL,
  schema_version text NOT NULL,
  metadata_digest char(64) NOT NULL,
  chunk_digest char(64) NOT NULL,
  selected_transcript_count integer NOT NULL CHECK (selected_transcript_count >= 0),
  selected_chunk_count integer NOT NULL CHECK (selected_chunk_count >= 0),
  source_text_bytes integer NOT NULL CHECK (source_text_bytes >= 0),
  part_digests jsonb NOT NULL CHECK (jsonb_typeof(part_digests) = 'array' AND jsonb_array_length(part_digests) <= 64),
  coverage_digest char(64) NOT NULL,
  kind text NOT NULL CHECK (kind IN ('transcript', 'metadata_only')),
  state text NOT NULL CHECK (state IN ('planned','in_progress','blocked_unknown','ready','rejected','invalid','failed')),
  final_call_id uuid,
  finalization_digest char(64),
  -- JSONB text inserts spacing and key order after the compact wire is checked;
  -- twice the wire ceiling keeps SQL from rolling back an observed-use receipt.
  profile_json jsonb CHECK (profile_json IS NULL OR octet_length(profile_json::text) <= 8192),
  failure_code text,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  terminal_at timestamp(3),
  PRIMARY KEY (generation_id, cache_key),
  CONSTRAINT precomputed_content_profile_manifest_fk FOREIGN KEY (generation_id, video_id)
    REFERENCES recommendation_precomputed_build_source(generation_id, source_video_id) ON DELETE RESTRICT,
  CHECK ((kind = 'metadata_only' AND selected_transcript_count = 0 AND selected_chunk_count = 0
      AND source_text_bytes = 0 AND part_digests = '[]'::jsonb AND state IN ('ready','invalid')
      AND final_call_id IS NULL AND profile_json IS NULL)
    OR kind = 'transcript'),
  CHECK (kind <> 'transcript' OR state <> 'ready' OR
    (final_call_id IS NOT NULL AND finalization_digest IS NOT NULL AND profile_json IS NOT NULL)),
  CHECK (state = 'ready' OR
    (final_call_id IS NULL AND finalization_digest IS NULL AND profile_json IS NULL)),
  CHECK ((state IN ('ready','rejected','invalid','failed')) = (terminal_at IS NOT NULL))
);
CREATE INDEX precomputed_content_profile_video_idx
  ON recommendation_precomputed_content_profile(generation_id, video_id);

CREATE TABLE recommendation_precomputed_profile_call (
  generation_id text NOT NULL REFERENCES recommendation_precomputed_generation(id) ON DELETE CASCADE,
  call_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  cache_key char(64) NOT NULL,
  node_key char(64) NOT NULL,
  stage text NOT NULL CHECK (stage IN ('map','reduce')),
  stage_prompt_version text NOT NULL,
  input_digest char(64) NOT NULL,
  part_index integer CHECK (part_index BETWEEN 0 AND 63),
  child_call_ids jsonb CHECK (child_call_ids IS NULL OR
    (jsonb_typeof(child_call_ids) = 'array' AND jsonb_array_length(child_call_ids) BETWEEN 2 AND 8)),
  started_at timestamp(3) NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','succeeded','rejected','failed')),
  output_digest char(64),
  -- The application enforces 2048 compact UTF-8 bytes before this wider physical bound.
  node_json jsonb CHECK (node_json IS NULL OR octet_length(node_json::text) <= 4096),
  covered_part_start integer,
  covered_part_end integer,
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens > 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cached_input_tokens integer CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  error_code text,
  finished_at timestamp(3),
  receipt_digest char(64),
  receipt_node_applied boolean,
  PRIMARY KEY (generation_id, call_id),
  CONSTRAINT precomputed_profile_call_attempt_fk FOREIGN KEY (generation_id, attempt_id)
    REFERENCES recommendation_precomputed_execution_attempt(generation_id, attempt_id) ON DELETE RESTRICT,
  CONSTRAINT precomputed_profile_call_profile_fk FOREIGN KEY (generation_id, cache_key)
    REFERENCES recommendation_precomputed_content_profile(generation_id, cache_key) ON DELETE RESTRICT,
  CHECK ((stage = 'map' AND part_index IS NOT NULL AND child_call_ids IS NULL)
    OR (stage = 'reduce' AND part_index IS NULL AND child_call_ids IS NOT NULL)),
  CHECK ((status = 'pending' AND finished_at IS NULL AND input_tokens IS NULL AND
      output_tokens IS NULL AND cached_input_tokens IS NULL AND receipt_digest IS NULL
      AND receipt_node_applied IS NULL)
    OR (status <> 'pending' AND finished_at IS NOT NULL AND input_tokens IS NOT NULL AND
      output_tokens IS NOT NULL AND receipt_digest IS NOT NULL AND receipt_node_applied IS NOT NULL)),
  CHECK ((status = 'succeeded' AND output_digest IS NOT NULL AND node_json IS NOT NULL AND
      covered_part_start IS NOT NULL AND covered_part_end IS NOT NULL AND error_code IS NULL)
    OR (status <> 'succeeded' AND output_digest IS NULL AND node_json IS NULL AND
      covered_part_start IS NULL AND covered_part_end IS NULL))
);
CREATE INDEX precomputed_profile_call_profile_idx
  ON recommendation_precomputed_profile_call(generation_id, cache_key, started_at);
CREATE UNIQUE INDEX precomputed_profile_call_pending_node_idx
  ON recommendation_precomputed_profile_call(generation_id, cache_key, node_key)
  WHERE status = 'pending';

COMMIT;
RESET lock_timeout;
RESET statement_timeout;

-- Add a separately gated historical build protocol without changing v2 rows.
SET lock_timeout = '1000ms';
SET statement_timeout = '15000ms';
BEGIN;

ALTER TABLE recommendation_precomputed_generation
  DROP CONSTRAINT recommendation_precomputed_generation_protocol_check,
  ADD CONSTRAINT recommendation_precomputed_generation_protocol_check
    CHECK (protocol_version IN (1, 2, 3)),
  DROP CONSTRAINT recommendation_precomputed_generation_snapshot_mode_check,
  ADD CONSTRAINT recommendation_precomputed_generation_snapshot_mode_check
    CHECK (input_snapshot_mode IN ('fixture', 'observed_fenced', 'preflight_failed', 'ga_aggregate_capture_v1'));

-- The orphan deadline is measured from Admin's receipt reservation, not the
-- caller's timestamp, so a stale/forged started_at cannot shorten the wait.
ALTER TABLE recommendation_precomputed_history_call
  ADD COLUMN reserved_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- One compact receipt per immutable private object. No FK: it must survive
-- generation deletion until the post-commit object-store cleanup succeeds.
CREATE TABLE recommendation_precomputed_ga_capture_artifact (
  generation_id TEXT NOT NULL,
  artifact_sha256 CHAR(64) NOT NULL,
  storage_key VARCHAR(300) NOT NULL,
  artifact_bytes BIGINT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  bound_at TIMESTAMP(3),
  PRIMARY KEY (generation_id, artifact_sha256),
  CONSTRAINT precomputed_ga_capture_sha_check CHECK (artifact_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT precomputed_ga_capture_bytes_check CHECK (artifact_bytes > 0 AND artifact_bytes <= 268435456)
);
CREATE INDEX precomputed_ga_capture_artifact_created_idx
  ON recommendation_precomputed_ga_capture_artifact (created_at, generation_id);

ALTER TABLE recommendation_precomputed_generation_retention_proof
  DROP CONSTRAINT recommendation_precomputed_ge_generation_protocol_version_check,
  ADD COLUMN snapshot_sha256 CHAR(64),
  ADD COLUMN artifact_deleted_at TIMESTAMP(3),
  ADD CONSTRAINT precomputed_retention_protocol_check
    CHECK (generation_protocol_version IN (1, 2, 3)),
  ADD CONSTRAINT precomputed_retention_snapshot_sha_check
    CHECK (snapshot_sha256 IS NULL OR snapshot_sha256 ~ '^[a-f0-9]{64}$');

COMMIT;
RESET lock_timeout;
RESET statement_timeout;

-- At-most-once enrichment starts. Ambiguous starts stay consumed; no timed lease
-- can safely infer whether an external provider has already spent resources.
CREATE SCHEMA IF NOT EXISTS enrichment_admission;
CREATE TABLE IF NOT EXISTS enrichment_admission.runs (
  run_id varchar(128) PRIMARY KEY,
  job_id varchar(128) NOT NULL,
  input_digest char(64) NOT NULL CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  status varchar(16) NOT NULL DEFAULT 'accepted'
    CHECK (status IN ('accepted', 'starting', 'started', 'ambiguous')),
  accepted_at timestamptz NOT NULL DEFAULT now()
);

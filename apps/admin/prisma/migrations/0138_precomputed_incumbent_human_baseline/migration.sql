-- Additive and default-off. This records verified incumbent-only Watch visits;
-- it does not alter the public serving pointer or activate a challenger.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

ALTER TABLE recommendation_precomputed_visit
  DROP CONSTRAINT recommendation_precomputed_visit_qualification_check;
ALTER TABLE recommendation_precomputed_visit
  ADD CONSTRAINT recommendation_precomputed_visit_qualification_check
  CHECK (qualification IN (
    'unverified_browser', 'unknown_signal', 'declared_automation',
    'private_preview', 'fixture_human', 'verified_human',
    'turnstile_verified_browser'
  ));

CREATE TABLE recommendation_precomputed_baseline_run (
  id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  verification_authority varchar(32) NOT NULL
    CHECK (verification_authority IN ('isolated_fixture', 'live_verified')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  stopped_at timestamptz,
  stopped_by varchar(191),
  control_routing_digest char(64) NOT NULL CHECK (control_routing_digest ~ '^[a-f0-9]{64}$'),
  actor_id varchar(191) NOT NULL,
  final_report jsonb,
  final_report_digest char(64) CHECK (final_report_digest IS NULL OR final_report_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (starts_at < ends_at),
  CHECK ((stopped_at IS NULL) = (stopped_by IS NULL)),
  CHECK (expires_at > ends_at),
  CHECK ((final_report IS NULL) = (final_report_digest IS NULL))
);
CREATE UNIQUE INDEX recommendation_precomputed_baseline_one_enabled_idx
  ON recommendation_precomputed_baseline_run (enabled) WHERE enabled;
CREATE INDEX recommendation_precomputed_baseline_run_window_idx
  ON recommendation_precomputed_baseline_run (ends_at, enabled);
CREATE INDEX recommendation_precomputed_baseline_run_expiry_idx
  ON recommendation_precomputed_baseline_run (expires_at);

CREATE TABLE recommendation_precomputed_baseline_visit (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES recommendation_precomputed_baseline_run(id) ON DELETE RESTRICT,
  browser_unit_digest char(64) NOT NULL CHECK (browser_unit_digest ~ '^[a-f0-9]{64}$'),
  source_video_id varchar(191) NOT NULL,
  locale varchar(32) NOT NULL,
  audio_language_slug varchar(64) NOT NULL,
  delivery_result varchar(32) NOT NULL DEFAULT 'not_attempted'
    CHECK (delivery_result IN ('not_attempted', 'served', 'fallback', 'empty', 'unavailable')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX recommendation_precomputed_baseline_visit_report_idx
  ON recommendation_precomputed_baseline_visit (run_id, created_at);
CREATE INDEX recommendation_precomputed_baseline_visit_browser_idx
  ON recommendation_precomputed_baseline_visit (run_id, browser_unit_digest);
CREATE INDEX recommendation_precomputed_baseline_visit_expiry_idx
  ON recommendation_precomputed_baseline_visit (expires_at, id);

CREATE TABLE recommendation_precomputed_baseline_visit_request (
  request_id varchar(191) PRIMARY KEY REFERENCES recommendation_request(id) ON DELETE CASCADE,
  visit_id uuid NOT NULL REFERENCES recommendation_precomputed_baseline_visit(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX recommendation_precomputed_baseline_request_visit_idx
  ON recommendation_precomputed_baseline_visit_request (visit_id);
CREATE INDEX recommendation_precomputed_baseline_request_expiry_idx
  ON recommendation_precomputed_baseline_visit_request (expires_at);

COMMIT;

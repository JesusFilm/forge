BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
CREATE TABLE recommendation_playback_signal_readiness (
  id TEXT PRIMARY KEY,
  family VARCHAR(16) NOT NULL CHECK (family IN ('navigation', 'qoe')),
  policy_version VARCHAR(64) NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  episode_count INTEGER NOT NULL CHECK (episode_count >= 0),
  v2_summary_count INTEGER NOT NULL CHECK (v2_summary_count >= 0 AND v2_summary_count <= episode_count),
  observed_count INTEGER NOT NULL CHECK (observed_count >= 0),
  partial_count INTEGER NOT NULL CHECK (partial_count >= 0),
  missing_count INTEGER NOT NULL CHECK (missing_count >= 0),
  ingestion_health VARCHAR(16) NOT NULL CHECK (ingestion_health IN ('healthy', 'degraded', 'unknown')),
  decision VARCHAR(48) NOT NULL CHECK (decision IN (
    'eligible_for_shadow_evaluation', 'revise', 'retire', 'inconclusive'
  )),
  reason_codes TEXT[] NOT NULL DEFAULT '{}',
  reevaluation_condition VARCHAR(191) NOT NULL,
  ranking_influence BOOLEAN NOT NULL DEFAULT false CHECK (ranking_influence = false),
  input_digest CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recommendation_playback_signal_readiness_window_check CHECK (window_start < window_end),
  CONSTRAINT recommendation_playback_signal_readiness_counts_check CHECK (
    observed_count + partial_count + missing_count = episode_count
  )
);
CREATE UNIQUE INDEX recommendation_playback_signal_readiness_revision_key
  ON recommendation_playback_signal_readiness(family, revision);
CREATE UNIQUE INDEX recommendation_playback_signal_readiness_input_key
  ON recommendation_playback_signal_readiness(family, window_start, window_end, input_digest);
CREATE INDEX recommendation_playback_signal_readiness_created_idx
  ON recommendation_playback_signal_readiness(family, created_at);
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
CREATE TABLE recommendation_viewing_mode_evidence (
  episode_id TEXT PRIMARY KEY REFERENCES recommendation_playback_episode(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES recommendation_profile(id) ON DELETE CASCADE,
  privacy_generation INTEGER NOT NULL CHECK (privacy_generation > 0),
  session_digest CHAR(64) NOT NULL,
  media_id VARCHAR(191) NOT NULL,
  policy_version VARCHAR(64) NOT NULL,
  fact_watermark INTEGER NOT NULL CHECK (fact_watermark > 0),
  sound_off_milliseconds INTEGER NOT NULL CHECK (sound_off_milliseconds >= 0),
  sound_on_milliseconds INTEGER NOT NULL CHECK (sound_on_milliseconds >= 0),
  sound_off_progress_seconds DOUBLE PRECISION NOT NULL CHECK (sound_off_progress_seconds >= 0),
  sound_on_progress_seconds DOUBLE PRECISION NOT NULL CHECK (sound_on_progress_seconds >= 0),
  sound_off_qualified BOOLEAN NOT NULL,
  sound_on_qualified BOOLEAN NOT NULL,
  preview_milliseconds INTEGER NOT NULL CHECK (preview_milliseconds >= 0),
  duration_seconds DOUBLE PRECISION,
  observed_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  CHECK (expires_at > observed_at)
);
CREATE INDEX recommendation_viewing_mode_profile_idx ON recommendation_viewing_mode_evidence(profile_id, privacy_generation, observed_at DESC);
CREATE INDEX recommendation_viewing_mode_media_idx ON recommendation_viewing_mode_evidence(media_id, observed_at DESC);
ALTER TABLE recommendation_personalization_decision
  DROP CONSTRAINT recommendation_personalization_execution_mode_check;
ALTER TABLE recommendation_personalization_decision
  ADD CONSTRAINT recommendation_personalization_execution_mode_check CHECK (
    execution_mode IS NULL OR
    (lane = 'semantic_control' AND execution_mode = 'semantic_contextual') OR
    (lane = 'profile_challenger' AND execution_mode IN ('hybrid_personalized', 'viewing_mode_personalized')) OR
    (lane = 'semantic_fallback' AND execution_mode IN ('semantic_fallback', 'curated_fallback'))
  ) NOT VALID;
ALTER TABLE recommendation_personalization_decision VALIDATE CONSTRAINT recommendation_personalization_execution_mode_check;
COMMIT;

-- Opt-in compact operational recency; historical roots remain format zero.
BEGIN;
SET LOCAL lock_timeout = '2s';

ALTER TABLE recommendation_playback_episode
  ADD COLUMN recency_format_version integer NOT NULL DEFAULT 0,
  ADD COLUMN recency_fact_watermark integer NOT NULL DEFAULT 0,
  ADD COLUMN recency_interval_count integer NOT NULL DEFAULT 0,
  ADD COLUMN recency_has_start boolean NOT NULL DEFAULT false,
  ADD COLUMN recency_start_received_at timestamptz,
  ADD COLUMN recency_start_expires_at timestamptz,
  ADD COLUMN recency_has_late boolean NOT NULL DEFAULT false;

ALTER TABLE recommendation_playback_episode
  ADD CONSTRAINT recommendation_episode_recency_state_check CHECK (
    (recency_format_version = 0 AND recency_fact_watermark = 0
      AND recency_interval_count = 0 AND NOT recency_has_start
      AND recency_start_received_at IS NULL AND recency_start_expires_at IS NULL
      AND NOT recency_has_late)
    OR (recency_format_version = 1 AND recency_fact_watermark BETWEEN 0 AND 128
      AND recency_interval_count BETWEEN 0 AND 64
      AND (recency_has_start = (recency_start_received_at IS NOT NULL))
      AND (recency_has_start = (recency_start_expires_at IS NOT NULL)))
  ) NOT VALID;

CREATE TABLE recommendation_playback_recency_interval (
  episode_id text NOT NULL REFERENCES recommendation_playback_episode(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  received_at timestamptz NOT NULL,
  interval_start timestamptz NOT NULL,
  interval_end timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT recommendation_playback_recency_interval_pkey PRIMARY KEY (episode_id, sequence),
  CONSTRAINT recommendation_playback_recency_interval_sequence_check CHECK (sequence > 0),
  CONSTRAINT recommendation_playback_recency_interval_range_check CHECK (
    interval_end > interval_start
    AND interval_end - interval_start <= interval '60 seconds'
  )
);

COMMIT;

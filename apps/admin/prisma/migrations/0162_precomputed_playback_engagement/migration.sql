-- Existing archives have unknown engagement: measured visits defaults to zero.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

ALTER TABLE recommendation_precomputed_ctr_cluster
  ADD COLUMN engaged_visits bigint NOT NULL DEFAULT 0 CHECK (engaged_visits >= 0 AND engaged_visits <= eligible_visits);

ALTER TABLE recommendation_precomputed_ctr_totals
  ADD COLUMN engagement_measured_visits bigint NOT NULL DEFAULT 0 CHECK (engagement_measured_visits >= 0),
  ADD COLUMN engaged_visits bigint NOT NULL DEFAULT 0 CHECK (engaged_visits >= 0),
  ADD COLUMN active_playback_milliseconds bigint NOT NULL DEFAULT 0 CHECK (active_playback_milliseconds >= 0),
  ADD COLUMN claimed_playbacks bigint NOT NULL DEFAULT 0 CHECK (claimed_playbacks >= 0),
  ADD COLUMN observed_playbacks bigint NOT NULL DEFAULT 0 CHECK (observed_playbacks >= 0),
  ADD COLUMN complete_playbacks bigint NOT NULL DEFAULT 0 CHECK (complete_playbacks >= 0),
  ADD COLUMN partial_playbacks bigint NOT NULL DEFAULT 0 CHECK (partial_playbacks >= 0),
  ADD COLUMN missing_outcome_playbacks bigint NOT NULL DEFAULT 0 CHECK (missing_outcome_playbacks >= 0),
  ADD COLUMN missing_coverage_playbacks bigint NOT NULL DEFAULT 0 CHECK (missing_coverage_playbacks >= 0),
  ADD COLUMN pending_playbacks bigint NOT NULL DEFAULT 0 CHECK (pending_playbacks >= 0),
  ADD COLUMN invalid_playbacks bigint NOT NULL DEFAULT 0 CHECK (invalid_playbacks >= 0);

COMMIT;

-- Additive compatibility: old images and generations retain their legacy scope.
-- No source population, generation identity or publication time is rewritten.
ALTER TABLE recommendation_cowatch_generation
  ADD COLUMN source_window_version VARCHAR(64) NOT NULL DEFAULT 'legacy-outcome-write-window-v1',
  ADD COLUMN window_start TIMESTAMP(3),
  ADD COLUMN evaluation_as_of TIMESTAMP(3),
  ADD COLUMN raw_source_count INTEGER,
  ADD COLUMN attempted_pair_count INTEGER,
  ADD CONSTRAINT recommendation_cowatch_source_window_check CHECK (
    source_window_version = 'legacy-outcome-write-window-v1'
    OR (
      source_window_version = 'episode-event-window-v1'
      AND window_start IS NOT NULL AND evaluation_as_of IS NOT NULL
      AND window_start < window_end AND window_end <= evaluation_as_of
      AND window_end - window_start <= INTERVAL '180 days'
    )
  ),
  ADD CONSTRAINT recommendation_cowatch_work_counts_check CHECK (
    (raw_source_count IS NULL OR (raw_source_count >= source_count AND raw_source_count <= 50000))
    AND (attempted_pair_count IS NULL OR (attempted_pair_count >= contribution_count AND attempted_pair_count <= 250000))
  );

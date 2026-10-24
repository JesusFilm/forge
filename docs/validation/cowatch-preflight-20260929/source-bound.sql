-- Derived from loadCowatchSourceRows at 1c3a3761d; count only, before eligibility.
-- PGOPTIONS: read-only, statement_timeout=5000, lock_timeout=1000.
SELECT jsonb_build_object('sourceBound',50000,'boundedSourceEpisodes',count(*),'overflow',count(*)>50000)
FROM (SELECT DISTINCT episode.id FROM recommendation_outcome_revision outcome
      JOIN recommendation_playback_episode episode ON episode.id = outcome.episode_id
      WHERE outcome.classifier_version = 'active-watch-proxy-v1'
        AND outcome.created_at >= '2026-04-01T20:27:08.256Z'::timestamptz
        AND outcome.created_at <= '2026-09-28T20:27:08.256Z'::timestamptz
 LIMIT 50001) bounded;

-- Exact declared canonical population, bounded count only; not a graph qualification.
SET LOCAL statement_timeout='5s';

    WITH latest AS MATERIALIZED (
      SELECT DISTINCT ON (episode.id)
        outcome.id AS "outcomeId",
        episode.id AS "episodeId",
        outcome.revision,
        episode.media_id AS "mediaId",
        episode.session_digest AS "sessionDigest",
        COALESCE(episode.claimed_at, episode.created_at) AS "occurredAt",
        outcome.view_quality_weight AS "qualityWeight",
        outcome.fact_watermark AS "factWatermark",
        episode.next_fact_sequence AS "nextFactSequence",
        episode.conflict_count AS "conflictCount",
        episode.replay_count AS "replayCount",
        outcome.request_id AS "requestId",
        outcome.qualified_view AS qualified,
        (episode.state = 'finalized' AND episode.finalized_at IS NOT NULL) AS finalized,
        outcome.expires_at AS "expiresAt",
        episode.expires_at AS "episodeExpiresAt"
      FROM recommendation_outcome_revision outcome
      JOIN recommendation_playback_episode episode ON episode.id = outcome.episode_id
      WHERE outcome.classifier_version = 'active-watch-proxy-v1'
        AND COALESCE(episode.claimed_at, episode.created_at) >= '2026-09-23T12:00:00.000Z'::timestamp
            AND COALESCE(episode.claimed_at, episode.created_at) < '2026-09-30T12:00:00.000Z'::timestamp
        AND outcome.created_at <= '2026-09-30T19:00:00.000Z'::timestamp
      ORDER BY episode.id, outcome.revision DESC, outcome.id DESC
    )
SELECT now() observed_at,current_setting('transaction_read_only') read_only,
 count(*) canonical_raw_rows,count(*)>50000 source_bound_exceeded
 FROM (SELECT 1 FROM latest LIMIT 50001) bounded;

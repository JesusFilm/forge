SET LOCAL statement_timeout='5s';
EXPLAIN (ANALYZE, FORMAT JSON, COSTS true, BUFFERS true, TIMING false)
    WITH canonical AS MATERIALIZED (
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
    ), latest AS MATERIALIZED (
      -- Keep the complete raw population/overflow sentinel before hydration.
      SELECT * FROM canonical
      ORDER BY "occurredAt", "episodeId"
      LIMIT 50001
    ), retained AS MATERIALIZED (
      -- Resolve each retained receipt once, rather than twice per raw episode.
      SELECT source.id, source.session_digest,
        source.viewer_profile_id AS profile_id,
        source.viewer_privacy_generation AS captured_generation,
        source.occurred_at, source.expires_at AS source_expires_at,
        generation.lineage_version,
        generation.expires_at AS generation_expires_at,
        outcome.episode_id, profile.privacy_generation, profile.state,
        profile.expires_at AS profile_expires_at
      FROM recommendation_cowatch_source_contribution source
      JOIN recommendation_outcome_revision outcome ON outcome.id = source.outcome_id
      JOIN recommendation_cowatch_generation generation ON generation.id = source.generation_id
      LEFT JOIN recommendation_profile profile ON profile.id = source.viewer_profile_id
      WHERE true AND source.viewer_profile_id IS NOT NULL
        AND (source.session_digest IN (SELECT "sessionDigest" FROM latest)
          OR outcome.episode_id IN (SELECT "episodeId" FROM latest))
    ), retained_matches AS MATERIALIZED (
      SELECT latest."episodeId" AS matched_episode, retained.*
      FROM latest JOIN retained ON retained.session_digest = latest."sessionDigest"
      UNION ALL
      SELECT latest."episodeId" AS matched_episode, retained.*
      FROM latest JOIN retained ON retained.episode_id = latest."episodeId"
    ), ownership AS MATERIALIZED (
      SELECT matched_episode,
        BOOL_OR(state IS DISTINCT FROM 'active' OR profile_expires_at <= '2026-09-30T19:38:04.000Z'::timestamp
          OR (lineage_version = 'durable-privacy-generation-v2'
            AND captured_generation IS DISTINCT FROM privacy_generation)) AS invalid
      FROM retained_matches
      GROUP BY matched_episode
    ), retained_identity AS MATERIALIZED (
      SELECT DISTINCT ON (matched_episode) matched_episode, profile_id,
        privacy_generation
      FROM retained_matches
      WHERE lineage_version = 'durable-privacy-generation-v2'
        AND generation_expires_at > '2026-09-30T19:38:04.000Z'::timestamp AND source_expires_at > '2026-09-30T19:38:04.000Z'::timestamp
        AND state = 'active' AND profile_expires_at > '2026-09-30T19:38:04.000Z'::timestamp
        AND privacy_generation = captured_generation
      ORDER BY matched_episode,
        CASE WHEN episode_id = matched_episode THEN 1 ELSE 2 END,
        occurred_at DESC, id DESC
    ), linked_identity AS MATERIALIZED (
      SELECT DISTINCT ON (link.session_digest) link.session_digest,
        profile.id, profile.privacy_generation
      FROM recommendation_profile_session_link link
      JOIN recommendation_profile profile ON profile.id = link.profile_id
        AND profile.privacy_generation = link.privacy_generation
        AND profile.state = 'active' AND profile.expires_at > '2026-09-30T19:38:04.000Z'::timestamp
      WHERE link.expires_at > '2026-09-30T19:38:04.000Z'::timestamp
        AND link.session_digest IN (SELECT "sessionDigest" FROM latest)
      ORDER BY link.session_digest, link.linked_at DESC, link.id DESC
    )
SELECT (SELECT count(*) FROM latest) canonical_rows,(SELECT count(*) FROM retained) retained_rows,(SELECT count(*) FROM retained_matches) retained_matches,(SELECT count(*) FROM ownership) known_owners,(SELECT count(*) FROM retained_identity) retained_identities,(SELECT count(*) FROM linked_identity) linked_identities;

EXPLAIN (FORMAT JSON, COSTS true, SETTINGS true)
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
    ), session_ownership AS MATERIALIZED (
      -- Reduce retained generations before joining raw episodes: a busy session
      -- must not multiply all of its raw episodes by every retained receipt.
      SELECT session_digest,
        BOOL_OR(state IS DISTINCT FROM 'active' OR profile_expires_at <= '2026-09-30T19:38:04.000Z'::timestamp
          OR (lineage_version = 'durable-privacy-generation-v2'
            AND captured_generation IS DISTINCT FROM privacy_generation)) AS invalid
      FROM retained
      GROUP BY session_digest
    ), episode_ownership AS MATERIALIZED (
      SELECT episode_id,
        BOOL_OR(state IS DISTINCT FROM 'active' OR profile_expires_at <= '2026-09-30T19:38:04.000Z'::timestamp
          OR (lineage_version = 'durable-privacy-generation-v2'
            AND captured_generation IS DISTINCT FROM privacy_generation)) AS invalid
      FROM retained
      GROUP BY episode_id
    ), valid_retained AS MATERIALIZED (
      SELECT id, session_digest, episode_id, profile_id, privacy_generation, occurred_at
      FROM retained
      WHERE lineage_version = 'durable-privacy-generation-v2'
        AND generation_expires_at > '2026-09-30T19:38:04.000Z'::timestamp AND source_expires_at > '2026-09-30T19:38:04.000Z'::timestamp
        AND state = 'active' AND profile_expires_at > '2026-09-30T19:38:04.000Z'::timestamp
        AND privacy_generation = captured_generation
    ), retained_session_identity AS MATERIALIZED (
      SELECT DISTINCT ON (session_digest) session_digest, profile_id, privacy_generation
      FROM valid_retained
      ORDER BY session_digest, occurred_at DESC, id DESC
    ), retained_episode_identity AS MATERIALIZED (
      SELECT DISTINCT ON (episode_id) episode_id, profile_id, privacy_generation
      FROM valid_retained
      ORDER BY episode_id, occurred_at DESC, id DESC
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
    SELECT latest.*,
      COALESCE(linked.id, retained_episode.profile_id, retained_session.profile_id) AS "profileId",
      COALESCE(linked.privacy_generation, retained_episode.privacy_generation, retained_session.privacy_generation) AS "privacyGeneration",
      decision.id AS "eligibilityDecisionId",
      decision.revision AS "eligibilityRevision",
      decision.policy_version AS "eligibilityPolicyVersion",
      (
        decision.id IS NOT NULL
        AND suppression.episode_id IS NULL
        AND (false OR (
          session_ownership.invalid IS NOT TRUE AND episode_ownership.invalid IS NOT TRUE
          AND (COALESCE(linked.id, retained_episode.profile_id, retained_session.profile_id) IS NOT NULL
            OR (session_ownership.session_digest IS NULL AND episode_ownership.episode_id IS NULL))
        ))
        AND latest."factWatermark" = latest."nextFactSequence" - 1
        AND latest."episodeExpiresAt" > '2026-09-30T19:38:04.000Z'::timestamp
        AND latest."conflictCount" = 0
        AND latest."replayCount" < 4
        AND NOT EXISTS (SELECT 1 FROM recommendation_playback_fact fact
          WHERE fact.episode_id = latest."episodeId" AND fact.late = true OFFSET 0)
        AND NOT EXISTS (SELECT 1 FROM recommendation_outcome_revision newer
          WHERE newer.supersedes_id = latest."outcomeId"
            OR (newer.episode_id = latest."episodeId" AND newer.classifier_version = 'active-watch-proxy-v1' AND newer.revision > latest.revision))
        AND NOT EXISTS (SELECT 1 FROM recommendation_promotion_slate_fence fence
          WHERE fence.request_id = latest."requestId")
        AND NOT EXISTS (
    SELECT 1 FROM recommendation_request owner_request
    WHERE owner_request.id = latest."requestId"
      AND owner_request.owner_release_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM recommendation_owner_release owner_release
        JOIN recommendation_promotion_pointer owner_pointer
          ON owner_pointer.id = 'recommendation-promotion-pointer'
        WHERE owner_release.id = owner_request.owner_release_id
          AND owner_release.pointer_generation = owner_request.owner_release_generation
          AND owner_release.revoked_at IS NULL
          AND owner_request.owner_release_generation >= owner_pointer.owner_influence_floor_generation
          AND owner_request.created_at >= owner_release.approved_at
          AND owner_request.created_at < owner_release.valid_until
      )
  )
      ) AS "integrityEligible"
    FROM latest
    LEFT JOIN linked_identity linked ON linked.session_digest = latest."sessionDigest"
    LEFT JOIN retained_episode_identity retained_episode ON retained_episode.episode_id = latest."episodeId"
    LEFT JOIN retained_session_identity retained_session ON retained_session.session_digest = latest."sessionDigest"
    LEFT JOIN session_ownership ON session_ownership.session_digest = latest."sessionDigest"
    LEFT JOIN episode_ownership ON episode_ownership.episode_id = latest."episodeId"
    LEFT JOIN LATERAL (
      SELECT eligible.id, eligible.revision, eligible.policy_version
      FROM recommendation_eligibility_decision eligible
      WHERE eligible.outcome_id = latest."outcomeId"
        AND eligible.policy_version = 'recommendation-integrity-v1'
        AND eligible.is_current = true
        AND eligible.state = 'eligible'
        AND 'aggregate' = ANY(eligible.eligible_scopes)
        AND eligible.expires_at > '2026-09-30T19:38:04.000Z'::timestamp
        AND eligible.source_type = 'playback_outcome'
      ORDER BY eligible.revision DESC
      LIMIT 1
    ) decision ON true
    LEFT JOIN recommendation_cowatch_suppression suppression
      ON suppression.episode_id = latest."episodeId"
    ORDER BY latest."occurredAt", latest."episodeId"
  ;

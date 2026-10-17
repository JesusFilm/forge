-- Frozen pre-optimization finite-source query, used only by owned native equivalence fixtures.

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
        AND COALESCE(episode.claimed_at, episode.created_at) >= $2::timestamp
            AND COALESCE(episode.claimed_at, episode.created_at) < $3::timestamp
        AND outcome.created_at <= $4::timestamp
      ORDER BY episode.id, outcome.revision DESC, outcome.id DESC
    )
    SELECT latest.*,
      profile.id AS "profileId",
      profile.privacy_generation AS "privacyGeneration",
      decision.id AS "eligibilityDecisionId",
      decision.revision AS "eligibilityRevision",
      decision.policy_version AS "eligibilityPolicyVersion",
      (
        decision.id IS NOT NULL
        AND suppression.episode_id IS NULL
        AND (false OR (
          ownership.invalid IS NOT TRUE
          AND (profile.id IS NOT NULL OR ownership.known = false)
        ))
        AND latest."factWatermark" = latest."nextFactSequence" - 1
        AND latest."episodeExpiresAt" > $1::timestamp
        AND latest."conflictCount" = 0
        AND latest."replayCount" < 4
        AND NOT EXISTS (SELECT 1 FROM recommendation_playback_fact fact
          WHERE fact.episode_id = latest."episodeId" AND fact.late = true)
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
    LEFT JOIN LATERAL (
      SELECT identity.id, identity.privacy_generation
      FROM (
      SELECT linked_profile.id, linked_profile.privacy_generation, 0 AS priority, link.linked_at AS identified_at, link.id AS identity_id
      FROM recommendation_profile_session_link link
      JOIN recommendation_profile linked_profile
        ON linked_profile.id = link.profile_id
        AND linked_profile.privacy_generation = link.privacy_generation
        AND linked_profile.state = 'active'
        AND linked_profile.expires_at > $1::timestamp
      WHERE link.session_digest = latest."sessionDigest"
        AND link.expires_at > $1::timestamp
      UNION ALL
      SELECT retained.profile_id, retained.privacy_generation,
        CASE WHEN retained.episode_id = latest."episodeId" THEN 1 ELSE 2 END AS priority,
        retained.occurred_at AS identified_at, retained.id AS identity_id
      FROM (
    SELECT source.id, source.viewer_profile_id AS profile_id,
      source.viewer_privacy_generation AS captured_generation, source.occurred_at,
      source.expires_at AS source_expires_at, generation.lineage_version,
      generation.expires_at AS generation_expires_at, outcome.episode_id,
      profile.privacy_generation, profile.state, profile.expires_at AS profile_expires_at
    FROM recommendation_cowatch_source_contribution source
    JOIN recommendation_outcome_revision outcome ON outcome.id = source.outcome_id
    JOIN recommendation_cowatch_generation generation ON generation.id = source.generation_id
    LEFT JOIN recommendation_profile profile ON profile.id = source.viewer_profile_id
    WHERE source.session_digest = latest."sessionDigest" AND source.viewer_profile_id IS NOT NULL
    UNION ALL
    SELECT source.id, source.viewer_profile_id AS profile_id,
      source.viewer_privacy_generation AS captured_generation, source.occurred_at,
      source.expires_at AS source_expires_at, generation.lineage_version,
      generation.expires_at AS generation_expires_at, outcome.episode_id,
      profile.privacy_generation, profile.state, profile.expires_at AS profile_expires_at
    FROM recommendation_outcome_revision outcome
    JOIN recommendation_cowatch_source_contribution source ON source.outcome_id = outcome.id
    JOIN recommendation_cowatch_generation generation ON generation.id = source.generation_id
    LEFT JOIN recommendation_profile profile ON profile.id = source.viewer_profile_id
    WHERE outcome.episode_id = latest."episodeId" AND source.viewer_profile_id IS NOT NULL
  ) retained
      WHERE true
        AND retained.lineage_version = 'durable-privacy-generation-v2'
        AND retained.generation_expires_at > $1::timestamp AND retained.source_expires_at > $1::timestamp
        AND retained.state = 'active' AND retained.profile_expires_at > $1::timestamp
        AND retained.privacy_generation = retained.captured_generation
      ) identity
      ORDER BY identity.priority, identity.identified_at DESC, identity.identity_id DESC
      LIMIT 1
    ) profile ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) > 0 AS known,
        BOOL_OR(retained.state IS DISTINCT FROM 'active' OR retained.profile_expires_at <= $1::timestamp
          OR (retained.lineage_version = 'durable-privacy-generation-v2'
            AND retained.captured_generation IS DISTINCT FROM retained.privacy_generation)) AS invalid
      FROM (
    SELECT source.id, source.viewer_profile_id AS profile_id,
      source.viewer_privacy_generation AS captured_generation, source.occurred_at,
      source.expires_at AS source_expires_at, generation.lineage_version,
      generation.expires_at AS generation_expires_at, outcome.episode_id,
      profile.privacy_generation, profile.state, profile.expires_at AS profile_expires_at
    FROM recommendation_cowatch_source_contribution source
    JOIN recommendation_outcome_revision outcome ON outcome.id = source.outcome_id
    JOIN recommendation_cowatch_generation generation ON generation.id = source.generation_id
    LEFT JOIN recommendation_profile profile ON profile.id = source.viewer_profile_id
    WHERE source.session_digest = latest."sessionDigest" AND source.viewer_profile_id IS NOT NULL
    UNION ALL
    SELECT source.id, source.viewer_profile_id AS profile_id,
      source.viewer_privacy_generation AS captured_generation, source.occurred_at,
      source.expires_at AS source_expires_at, generation.lineage_version,
      generation.expires_at AS generation_expires_at, outcome.episode_id,
      profile.privacy_generation, profile.state, profile.expires_at AS profile_expires_at
    FROM recommendation_outcome_revision outcome
    JOIN recommendation_cowatch_source_contribution source ON source.outcome_id = outcome.id
    JOIN recommendation_cowatch_generation generation ON generation.id = source.generation_id
    LEFT JOIN recommendation_profile profile ON profile.id = source.viewer_profile_id
    WHERE outcome.episode_id = latest."episodeId" AND source.viewer_profile_id IS NOT NULL
  ) retained
      WHERE true
    ) ownership ON true
    LEFT JOIN LATERAL (
      SELECT eligible.id, eligible.revision, eligible.policy_version
      FROM recommendation_eligibility_decision eligible
      WHERE eligible.outcome_id = latest."outcomeId"
        AND eligible.policy_version = 'recommendation-integrity-v1'
        AND eligible.is_current = true
        AND eligible.state = 'eligible'
        AND 'aggregate' = ANY(eligible.eligible_scopes)
        AND eligible.expires_at > $1::timestamp
        AND eligible.source_type = 'playback_outcome'
      ORDER BY eligible.revision DESC
      LIMIT 1
    ) decision ON true
    LEFT JOIN recommendation_cowatch_suppression suppression
      ON suppression.episode_id = latest."episodeId"
    ORDER BY latest."occurredAt", latest."episodeId"
    LIMIT 50001
  ;

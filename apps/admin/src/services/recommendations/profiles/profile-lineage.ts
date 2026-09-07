import { Prisma } from "@prisma/client"
import {
  ACTIVE_WATCH_PROXY_VERSION,
  RECOMMENDATION_CONTRACTS,
} from "../contracts"
import {
  RECOMMENDATION_INTEGRITY_POLICY_VERSION,
  RECOMMENDATION_REPLAY_QUARANTINE_THRESHOLD,
} from "../integrity-policy"
import { PROFILE_PROJECTION_VERSION } from "./projection"

/**
 * Canonical invalid-contribution predicate. Callers provide joins using the
 * aliases `contribution`, `decision`, `outcome`, `episode`, `selection`, and
 * `selected_item`, keeping serving and aggregate evidence on identical rules.
 */
export function profileContributionInvalidPredicateSql(now: Date): Prisma.Sql {
  return Prisma.sql`(
    contribution.expires_at <= ${now}
    OR contribution.kind NOT IN ('qualified_outcome', 'session_selection')
    OR decision.id IS NULL
    OR decision.is_current <> true
    OR decision.state <> 'eligible'
    OR decision.policy_version <> ${RECOMMENDATION_INTEGRITY_POLICY_VERSION}
    OR decision.revision IS DISTINCT FROM contribution.source_eligibility_revision
    OR contribution.eligibility_policy_version IS DISTINCT FROM decision.policy_version
    OR decision.expires_at <= ${now}
    OR NOT ('profile' = ANY(decision.eligible_scopes))
    OR (
      contribution.kind = 'qualified_outcome'
      AND (
        outcome.id IS NULL
        OR episode.id IS NULL
        OR decision.outcome_id IS DISTINCT FROM outcome.id
        OR decision.source_type::text <> 'playback_outcome'
        OR outcome.classifier_version <> ${ACTIVE_WATCH_PROXY_VERSION}
        OR contribution.outcome_classifier_version IS DISTINCT FROM outcome.classifier_version
        OR outcome.qualified_view <> true
        OR outcome.expires_at <= ${now}
        OR contribution.target_media_id <> episode.media_id
        OR episode.state::text <> 'finalized'
        OR episode.finalized_at IS NULL
        OR outcome.fact_watermark <> episode.next_fact_sequence - 1
        OR episode.conflict_count > 0
        OR episode.replay_count >= ${RECOMMENDATION_REPLAY_QUARANTINE_THRESHOLD}
        OR EXISTS (
          SELECT 1
          FROM recommendation_playback_fact fact
          WHERE fact.episode_id = episode.id
            AND fact.late = true
        )
        OR EXISTS (
          SELECT 1
          FROM recommendation_outcome_revision superseding
          WHERE superseding.supersedes_id = outcome.id
        )
        OR EXISTS (
          SELECT 1
          FROM recommendation_promotion_slate_fence fence
          WHERE fence.request_id = outcome.request_id
        )
      )
    )
    OR (
      contribution.kind = 'session_selection'
      AND (
        selection.id IS NULL
        OR decision.selection_id IS DISTINCT FROM selection.id
        OR decision.source_type::text <> 'selection'
        OR contribution.outcome_classifier_version IS NOT NULL
        OR selection.attribution_eligible_at IS NULL
        OR selection.attribution_eligible_at > ${now}
        OR selection.expires_at <= ${now}
        OR selected_item.id IS NULL
        OR contribution.target_media_id <> selected_item.target_media_id
        OR EXISTS (
          SELECT 1
          FROM recommendation_conflict conflict
          WHERE conflict.capability_jti = selection.capability_jti
            AND conflict.event_id = selection.event_id
        )
        OR EXISTS (
          SELECT 1
          FROM recommendation_impression conflicted_impression
          JOIN recommendation_conflict conflict
            ON conflict.capability_jti = conflicted_impression.capability_jti
            AND conflict.event_id = conflicted_impression.event_id
          WHERE conflicted_impression.request_id = selection.request_id
            AND conflicted_impression.item_id = selection.item_id
        )
        OR EXISTS (
          SELECT 1
          FROM recommendation_promotion_slate_fence fence
          WHERE fence.request_id = selection.request_id
        )
        OR NOT EXISTS (
          SELECT 1
          FROM recommendation_impression impression
          WHERE impression.request_id = selection.request_id
            AND impression.item_id = selection.item_id
            AND impression.expires_at > ${now}
            AND impression.expires_at >= selection.attribution_eligible_at
            AND impression.visibility_policy = ${RECOMMENDATION_CONTRACTS.surface}
        )
      )
    )
  )`
}

/**
 * One bounded fail-closed predicate shared by serving, reconciliation, and
 * aggregate operations evidence. It validates the exact eligibility revision
 * captured by every immutable contribution and the source facts that can
 * invalidate that revision after publication.
 */
export function profileLineageEligibleSql(
  generationId: Prisma.Sql,
  now: Date,
): Prisma.Sql {
  return Prisma.sql`(
    COALESCE((
      SELECT
        versioned_generation.projection_version = ${PROFILE_PROJECTION_VERSION}
        AND versioned_generation.eligibility_policy_version = ${RECOMMENDATION_INTEGRITY_POLICY_VERSION}
        AND versioned_generation.outcome_classifier_version = ${ACTIVE_WATCH_PROXY_VERSION}
      FROM recommendation_profile_projection_generation versioned_generation
      WHERE versioned_generation.id = ${generationId}
    ), false)
    AND (
      SELECT COUNT(*)::int
      FROM recommendation_profile_projection_contribution counted_contribution
      WHERE counted_contribution.generation_id = ${generationId}
    ) = COALESCE((
      SELECT counted_generation.contribution_count
      FROM recommendation_profile_projection_generation counted_generation
      WHERE counted_generation.id = ${generationId}
    ), -1)
    AND NOT EXISTS (
      SELECT 1
      FROM recommendation_profile_interest interest
      WHERE interest.generation_id = ${generationId}
        AND (
          (interest.kind = 'durable' AND NOT EXISTS (
            SELECT 1
            FROM recommendation_profile_projection_contribution supporting
            WHERE supporting.generation_id = interest.generation_id
              AND supporting.kind = 'qualified_outcome'
              AND supporting.interest_ordinal = interest.interest_ordinal
          ))
          OR (interest.kind = 'session' AND NOT EXISTS (
            SELECT 1
            FROM recommendation_profile_projection_contribution supporting
            WHERE supporting.generation_id = interest.generation_id
              AND supporting.kind = 'session_selection'
          ))
        )
    )
    AND NOT EXISTS (
    SELECT 1
    FROM recommendation_profile_projection_contribution contribution
    LEFT JOIN recommendation_eligibility_decision decision
      ON decision.id = contribution.source_eligibility_decision_id
    LEFT JOIN recommendation_outcome_revision outcome
      ON outcome.id = contribution.source_outcome_id
    LEFT JOIN recommendation_playback_episode episode
      ON episode.id = outcome.episode_id
    LEFT JOIN recommendation_selection selection
      ON selection.id = contribution.source_selection_id
    LEFT JOIN recommendation_served_item selected_item
      ON selected_item.request_id = selection.request_id
      AND selected_item.id = selection.item_id
    WHERE contribution.generation_id = ${generationId}
      AND ${profileContributionInvalidPredicateSql(now)}
    )
  )`
}

import { ownerReleaseInfluenceAllowedSql } from "../promotion/owner-influence"
import { Prisma } from "@prisma/client"
import {
  RECOMMENDATION_INTEGRITY_POLICY_VERSION,
  RECOMMENDATION_REPLAY_QUARANTINE_THRESHOLD,
} from "../integrity-policy"

/** Shared full-validation predicate. Live serving uses the durable invalidation latch. */
export function cowatchSourceInvalidSql(
  now: Date,
  lineageVersion: string,
): Prisma.Sql {
  return Prisma.sql`(
            source_row.expires_at <= ${now}
            OR outcome.expires_at <= ${now}
            OR episode.expires_at <= ${now}
            OR outcome.qualified_view = false
            OR outcome.classifier_version <> 'active-watch-proxy-v1'
            OR episode.state <> 'finalized'
            OR episode.finalized_at IS NULL
            OR episode.media_id <> source_row.media_id
            OR outcome.fact_watermark <> episode.next_fact_sequence - 1
            OR episode.conflict_count > 0
            OR episode.replay_count >= ${RECOMMENDATION_REPLAY_QUARANTINE_THRESHOLD}
            OR EXISTS (SELECT 1 FROM recommendation_playback_fact fact
              WHERE fact.episode_id = episode.id AND fact.late = true)
            OR EXISTS (SELECT 1 FROM recommendation_promotion_slate_fence fence
              WHERE fence.request_id = outcome.request_id)
            OR NOT ${ownerReleaseInfluenceAllowedSql(Prisma.sql`outcome.request_id`)}
            OR suppression.episode_id IS NOT NULL
            OR decision.id IS NULL
            OR decision.is_current <> true
            OR decision.state <> 'eligible'
            OR decision.source_type <> 'playback_outcome'
            OR decision.outcome_id IS DISTINCT FROM outcome.id
            OR decision.revision <> source_row.eligibility_revision
            OR decision.policy_version <> ${RECOMMENDATION_INTEGRITY_POLICY_VERSION}
            OR decision.policy_version <> source_row.eligibility_policy_version
            OR decision.expires_at <= ${now}
            OR NOT ('aggregate' = ANY(decision.eligible_scopes))
            OR (source_row.viewer_profile_id IS NOT NULL AND (
              profile.state IS DISTINCT FROM 'active' OR profile.expires_at <= ${now}
              OR (
                ${lineageVersion} = 'durable-privacy-generation-v2'
                AND source_row.viewer_privacy_generation IS DISTINCT FROM profile.privacy_generation
              )
              OR (${lineageVersion} <> 'durable-privacy-generation-v2' AND NOT EXISTS (
                SELECT 1 FROM recommendation_profile_session_link link
                WHERE link.profile_id = profile.id
                  AND link.session_digest = source_row.session_digest
                  AND link.privacy_generation = profile.privacy_generation
                  AND link.expires_at > ${now}
              ))
            ))
            OR EXISTS (SELECT 1 FROM recommendation_outcome_revision newer
              WHERE newer.supersedes_id = outcome.id OR (newer.episode_id = outcome.episode_id AND newer.classifier_version = outcome.classifier_version AND newer.revision > outcome.revision))
          )`
}

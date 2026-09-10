import type { PrismaClient } from "@prisma/client"
import { ACTIVE_WATCH_PROXY_VERSION } from "./contracts"
import { RECOMMENDATION_INTEGRITY_POLICY_VERSION } from "./integrity-policy"

export type UserWatchHistory = {
  mediaId: string
  videoCoreId?: string | null
  completed: boolean
}[]

/** At most 24 recently qualified videos over seven days, from this anonymous
 * profile's authorized sessions. Includes direct/search/editorial playback.
 * Pending, stale, conflicted and superseded outcomes never alter this row.
 */
export async function getUserWatchHistory(
  prisma: Pick<PrismaClient, "$queryRaw">,
  input: {
    sessionDigest: string
    profileTokenDigest: string | null
    now: Date
  },
): Promise<UserWatchHistory> {
  if (!input.profileTokenDigest) return []
  const windowStart = new Date(input.now.getTime() - 7 * 86_400_000)
  return prisma.$queryRaw<UserWatchHistory>`
    WITH sessions AS MATERIALIZED (
      SELECT link.session_digest, GREATEST(link.linked_at, ${windowStart}) AS since
      FROM recommendation_profile profile
      JOIN recommendation_profile_session_link link ON link.profile_id = profile.id
        AND link.privacy_generation = profile.privacy_generation AND link.expires_at > ${input.now}
      WHERE profile.token_digest = ${input.profileTokenDigest}
        AND profile.state = 'active' AND profile.expires_at > ${input.now}
      ORDER BY (link.session_digest = ${input.sessionDigest}) DESC, link.linked_at DESC
      LIMIT 8
    ), episodes AS MATERIALIZED (
      SELECT episode.* FROM sessions session
      CROSS JOIN LATERAL (
        SELECT e.id, e.media_id, e.next_fact_sequence, e.finalized_at
        FROM recommendation_playback_episode e
        WHERE e.session_digest = session.session_digest AND e.created_at >= session.since
          AND e.created_at <= ${input.now} AND e.expires_at > ${input.now}
          AND e.state = 'finalized' AND e.conflict_count = 0
        ORDER BY e.created_at DESC, e.id DESC LIMIT 32
      ) episode
    )
    SELECT episode.media_id AS "mediaId", video.core_id AS "videoCoreId", bool_or(EXISTS (
      SELECT 1 FROM recommendation_playback_fact fact WHERE fact.episode_id = episode.id
        AND fact.kind = 'playback_end' AND fact.payload->>'completed' = 'true' AND NOT fact.late
    )) AS completed
    FROM episodes episode
    LEFT JOIN video ON video.id = episode.media_id
    JOIN recommendation_outcome_revision outcome ON outcome.episode_id = episode.id
      AND outcome.classifier_version = ${ACTIVE_WATCH_PROXY_VERSION} AND outcome.qualified_view
      AND outcome.fact_watermark = episode.next_fact_sequence - 1 AND outcome.expires_at > ${input.now}
    JOIN recommendation_eligibility_decision decision ON decision.outcome_id = outcome.id
      AND decision.is_current AND decision.state = 'eligible'
      AND decision.policy_version = ${RECOMMENDATION_INTEGRITY_POLICY_VERSION}
      AND 'profile' = ANY(decision.eligible_scopes) AND decision.expires_at > ${input.now}
    WHERE NOT EXISTS (SELECT 1 FROM recommendation_outcome_revision newer WHERE newer.supersedes_id = outcome.id)
      AND NOT EXISTS (SELECT 1 FROM recommendation_playback_fact late WHERE late.episode_id = episode.id AND late.late)
    GROUP BY episode.media_id, video.core_id ORDER BY max(episode.finalized_at) DESC, episode.media_id LIMIT 24
  `
}

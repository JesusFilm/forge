import type { PrismaClient } from "@prisma/client"
import { ACTIVE_WATCH_PROXY_VERSION } from "./contracts"
import { RECOMMENDATION_INTEGRITY_POLICY_VERSION } from "./integrity-policy"
import { recentPlaybackCtes } from "./recent-playback.sql"

export type UserWatchHistory = {
  mediaId: string
  videoCoreId?: string | null
  videoTitle?: string | null
  completed: boolean
  recentlyTried?: boolean
  qualified?: boolean
}[]

/** Bounded qualified history plus recent actual playback from any source.
 * Short-only evidence affects freshness, never thematic interest retrieval.
 */
export async function getUserWatchHistory(
  prisma: Pick<PrismaClient, "$queryRaw">,
  input: {
    sessionDigest: string
    profileTokenDigest: string | null
    locale: string
    now: Date
  },
): Promise<UserWatchHistory> {
  if (!input.profileTokenDigest) return []
  const windowStart = new Date(input.now.getTime() - 7 * 86_400_000)
  return prisma.$queryRaw<UserWatchHistory>`
    WITH scoped_sessions AS MATERIALIZED (
      SELECT link.session_digest, GREATEST(link.linked_at, profile.created_at, ${windowStart}) AS authorization_start
      FROM recommendation_profile profile
      JOIN recommendation_profile_session_link link ON link.profile_id = profile.id
        AND link.privacy_generation = profile.privacy_generation AND link.expires_at > ${input.now}
      WHERE profile.token_digest = ${input.profileTokenDigest}
        AND profile.state = 'active' AND profile.expires_at > ${input.now}
      ORDER BY (link.session_digest = ${input.sessionDigest}) DESC, link.expires_at DESC, link.session_digest
      LIMIT 8
    ), ${recentPlaybackCtes(input.now)}, episodes AS MATERIALIZED (
      SELECT episode.* FROM scoped_sessions session
      CROSS JOIN LATERAL (
        SELECT e.id, e.media_id, e.next_fact_sequence, e.finalized_at
        FROM recommendation_playback_episode e
        WHERE e.session_digest = session.session_digest AND e.created_at >= session.authorization_start
          AND e.created_at <= ${input.now} AND e.expires_at > ${input.now}
          AND e.state = 'finalized' AND e.conflict_count = 0
        ORDER BY e.created_at DESC, e.id DESC LIMIT 32
      ) episode
    ), qualified_history AS MATERIALIZED (
    SELECT episode.media_id, max(episode.finalized_at) AS latest_at, bool_or(EXISTS (
      SELECT 1 FROM recommendation_playback_fact fact WHERE fact.episode_id = episode.id
        AND fact.kind = 'playback_end' AND fact.payload->>'completed' = 'true' AND NOT fact.late
    )) AS completed
    FROM episodes episode
    JOIN recommendation_outcome_revision outcome ON outcome.episode_id = episode.id
      AND outcome.classifier_version = ${ACTIVE_WATCH_PROXY_VERSION} AND outcome.qualified_view
      AND outcome.fact_watermark = episode.next_fact_sequence - 1 AND outcome.expires_at > ${input.now}
    JOIN recommendation_eligibility_decision decision ON decision.outcome_id = outcome.id
      AND decision.is_current AND decision.state = 'eligible'
      AND decision.policy_version = ${RECOMMENDATION_INTEGRITY_POLICY_VERSION}
      AND 'profile' = ANY(decision.eligible_scopes) AND decision.expires_at > ${input.now}
    WHERE NOT EXISTS (SELECT 1 FROM recommendation_outcome_revision newer WHERE newer.supersedes_id = outcome.id)
      AND NOT EXISTS (SELECT 1 FROM recommendation_playback_fact late WHERE late.episode_id = episode.id AND late.late)
    GROUP BY episode.media_id ORDER BY max(episode.finalized_at) DESC, episode.media_id LIMIT 24
    ), tried_history AS (
      SELECT * FROM recent_playback ORDER BY latest_at DESC, media_id LIMIT 24
    )
    SELECT COALESCE(qualified.media_id, tried.media_id) AS "mediaId",
      video.core_id AS "videoCoreId", localized.title AS "videoTitle", COALESCE(qualified.completed, false) AS completed,
      tried.media_id IS NOT NULL AS "recentlyTried", qualified.media_id IS NOT NULL AS qualified
    FROM qualified_history qualified
    FULL JOIN tried_history tried ON tried.media_id = qualified.media_id
    LEFT JOIN video ON video.id = COALESCE(qualified.media_id, tried.media_id)
    LEFT JOIN video_locale localized ON localized.video_id = video.id AND localized.locale = ${input.locale}
    ORDER BY GREATEST(qualified.latest_at, tried.latest_at) DESC, "mediaId"
  `
}

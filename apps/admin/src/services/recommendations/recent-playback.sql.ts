import { Prisma } from "@prisma/client"
import { RECOMMENDATION_REPLAY_QUARANTINE_THRESHOLD } from "./integrity-policy"

export const RECENT_PLAYBACK_MIN_MILLISECONDS = 3_000
export const RECENT_PLAYBACK_WINDOW_MILLISECONDS = 24 * 60 * 60 * 1_000
export const MAX_RECENT_CONTEXT_EPISODES_PER_SESSION = 32

/** Shared by both surfaces. The caller supplies authorized scoped_sessions
 * (session_digest, authorization_start); card attribution is never required.
 * Read accepted facts directly so recency does not wait for finalization.
 */
export function recentPlaybackCtes(now: Date): Prisma.Sql {
  const since = new Date(now.getTime() - RECENT_PLAYBACK_WINDOW_MILLISECONDS)
  return Prisma.sql`
    recent_episodes AS MATERIALIZED (
      SELECT episode.id, episode.media_id
      FROM scoped_sessions session
      CROSS JOIN LATERAL (
        SELECT root.id, root.media_id
        FROM recommendation_playback_episode root
        WHERE root.session_digest = session.session_digest
          AND root.created_at >= session.authorization_start
          AND root.created_at <= ${now}
          AND root.expires_at > ${now}
          AND root.state IN ('claimed', 'finalized', 'timed_out')
          AND root.conflict_count = 0
          AND root.replay_count < ${RECOMMENDATION_REPLAY_QUARANTINE_THRESHOLD}
        ORDER BY root.created_at DESC, root.id DESC
        LIMIT ${MAX_RECENT_CONTEXT_EPISODES_PER_SESSION}
      ) episode
    ),
    -- Evaluate episode-wide integrity once per bounded root, before the fact
    -- fanout can cause PostgreSQL to repeat these probes for every interval.
    validated_recent_episodes AS MATERIALIZED (
      SELECT episode.id, episode.media_id
      FROM recent_episodes episode
      WHERE EXISTS (
        SELECT 1 FROM recommendation_playback_fact started
        WHERE started.episode_id = episode.id AND started.kind = 'playback_start'
          AND NOT started.late AND started.received_at <= ${now}
          AND started.expires_at > ${now}
      )
      AND NOT EXISTS (
        SELECT 1 FROM recommendation_playback_fact late
        WHERE late.episode_id = episode.id AND late.late
      )
    ),
    active_intervals AS MATERIALIZED (
      SELECT episode.id, episode.media_id, fact.received_at,
        fact.occurred_at AS interval_end,
        fact.occurred_at - (fact.payload->>'activeMilliseconds')::double precision
          * interval '1 millisecond' AS interval_start
      FROM validated_recent_episodes episode
      JOIN recommendation_playback_fact fact ON fact.episode_id = episode.id
        AND fact.kind = 'playback_active_visible_playing'
        AND NOT fact.late
        -- Client-clock skew is checked at ingestion. Recency uses server time.
        AND fact.received_at > ${since} AND fact.received_at <= ${now}
        AND fact.expires_at > ${now}
        AND (fact.payload->>'activeMilliseconds')::double precision BETWEEN 1 AND 60000
    ),
    covered_intervals AS (
      SELECT *, max(interval_end) OVER (
        PARTITION BY id ORDER BY interval_start, interval_end
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ) AS previous_end
      FROM active_intervals
    ),
    tried_episodes AS (
      SELECT id, media_id, max(received_at) AS latest_at
      FROM covered_intervals
      GROUP BY id, media_id
      HAVING sum(GREATEST(0, EXTRACT(EPOCH FROM (
        interval_end - GREATEST(interval_start, COALESCE(previous_end, interval_start))
      )) * 1000)) >= ${RECENT_PLAYBACK_MIN_MILLISECONDS}
    ),
    recent_playback AS MATERIALIZED (
      SELECT media_id, max(latest_at) AS latest_at
      FROM tried_episodes GROUP BY media_id
    )
  `
}

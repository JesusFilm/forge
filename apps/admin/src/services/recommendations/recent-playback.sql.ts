import { Prisma } from "@prisma/client"
import { RECOMMENDATION_REPLAY_QUARANTINE_THRESHOLD } from "./integrity-policy"
import { env } from "@/config/env"

export const RECENT_PLAYBACK_MIN_MILLISECONDS = 3_000
export const RECENT_PLAYBACK_WINDOW_MILLISECONDS = 24 * 60 * 60 * 1_000
export const MAX_RECENT_CONTEXT_EPISODES_PER_SESSION = 32

/** Shared by both surfaces. The caller supplies authorized scoped_sessions
 * (session_digest, authorization_start); card attribution is never required.
 * Read accepted facts directly so recency does not wait for finalization.
 */
export function recentPlaybackCtes(
  now: Date,
  compactReaderEnabled = env.RECOMMENDATION_COMPACT_PLAYBACK_RECENCY_READER_ENABLED ===
    "1",
): Prisma.Sql {
  const since = new Date(now.getTime() - RECENT_PLAYBACK_WINDOW_MILLISECONDS)
  const compactSource = compactReaderEnabled
    ? Prisma.sql`(episode.recency_format_version = 1
          AND episode.recency_fact_watermark = episode.next_fact_sequence - 1
          AND episode.recency_interval_count = (
            SELECT count(*) FROM recommendation_playback_recency_interval interval_row
            WHERE interval_row.episode_id = episode.id
          ))`
    : Prisma.sql`false`
  return Prisma.sql`
    recent_episodes AS MATERIALIZED (
      SELECT episode.id, episode.media_id, episode.next_fact_sequence,
        episode.recency_format_version, episode.recency_fact_watermark,
        episode.recency_interval_count, episode.recency_has_start,
        episode.recency_start_received_at, episode.recency_start_expires_at,
        episode.recency_has_late
      FROM scoped_sessions session
      CROSS JOIN LATERAL (
        SELECT root.id, root.media_id, root.next_fact_sequence,
          root.recency_format_version, root.recency_fact_watermark,
          root.recency_interval_count, root.recency_has_start,
          root.recency_start_received_at, root.recency_start_expires_at,
          root.recency_has_late
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
    recency_sources AS MATERIALIZED (
      SELECT episode.*,
        ${compactSource} AS compact_complete
      FROM recent_episodes episode
    ),
    -- Evaluate episode-wide integrity once per bounded root, before the fact
    -- fanout can cause PostgreSQL to repeat these probes for every interval.
    validated_recent_episodes AS MATERIALIZED (
      SELECT episode.id, episode.media_id
      FROM recency_sources episode
      WHERE (CASE WHEN episode.compact_complete THEN
        episode.recency_has_start
        AND episode.recency_start_received_at <= ${now}
        AND episode.recency_start_expires_at > ${now}
      ELSE EXISTS (
        SELECT 1 FROM recommendation_playback_fact started
        WHERE started.episode_id = episode.id AND started.kind = 'playback_start'
          AND NOT started.late AND started.received_at <= ${now}
          AND started.expires_at > ${now}
      ) END)
      AND (CASE WHEN episode.compact_complete THEN NOT episode.recency_has_late
      ELSE NOT EXISTS (
        SELECT 1 FROM recommendation_playback_fact late
        WHERE late.episode_id = episode.id AND late.late
      ) END)
    ),
    active_intervals AS MATERIALIZED (
      SELECT episode.id, episode.media_id, fact.received_at,
        fact.occurred_at AS interval_end,
        fact.occurred_at - (fact.payload->>'activeMilliseconds')::double precision
          * interval '1 millisecond' AS interval_start
      FROM validated_recent_episodes episode
      JOIN recency_sources source ON source.id = episode.id
      JOIN recommendation_playback_fact fact ON fact.episode_id = episode.id
        AND NOT source.compact_complete
        AND fact.kind = 'playback_active_visible_playing'
        AND NOT fact.late
        -- Client-clock skew is checked at ingestion. Recency uses server time.
        AND fact.received_at > ${since} AND fact.received_at <= ${now}
        AND fact.expires_at > ${now}
        AND (fact.payload->>'activeMilliseconds')::double precision BETWEEN 1 AND 60000
      UNION ALL
      SELECT episode.id, episode.media_id, interval_row.received_at,
        interval_row.interval_end, interval_row.interval_start
      FROM validated_recent_episodes episode
      JOIN recency_sources source ON source.id = episode.id AND source.compact_complete
      JOIN recommendation_playback_recency_interval interval_row ON interval_row.episode_id = episode.id
        AND interval_row.received_at > ${since} AND interval_row.received_at <= ${now}
        AND interval_row.expires_at > ${now}
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

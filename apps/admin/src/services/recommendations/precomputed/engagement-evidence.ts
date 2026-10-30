import { Prisma } from "@prisma/client"

/** One aggregate row per visit; separate from impression joins to avoid
 * multiplying playback time. Uses the same server-received cutoff as CTR. */
export function visitEngagementSql(asOf: Date): Prisma.Sql {
  return Prisma.sql`
    SELECT
      count(*) AS claimed_playbacks,
      count(*) FILTER (WHERE usable AND active_coverage IN ('complete', 'partial')) AS observed_playbacks,
      count(*) FILTER (WHERE usable AND active_coverage = 'complete') AS complete_playbacks,
      count(*) FILTER (WHERE usable AND active_coverage = 'partial') AS partial_playbacks,
      count(*) FILTER (WHERE valid_episode AND outcome_id IS NULL) AS missing_outcome_playbacks,
      count(*) FILTER (WHERE valid_episode AND outcome_id IS NOT NULL
        AND (active_coverage IS NULL OR active_coverage NOT IN ('complete', 'partial')
          OR active_playback_milliseconds IS NULL)) AS missing_coverage_playbacks,
      count(*) FILTER (WHERE state NOT IN ('finalized', 'timed_out')
        OR hard_until > LEAST(${asOf}, v.expires_at,
          experiment.ends_at + COALESCE(policy.late_event_cutoff_hours, 672) * interval '1 hour')) AS pending_playbacks,
      count(*) FILTER (WHERE NOT valid_episode) AS invalid_playbacks,
      count(*) FILTER (WHERE usable AND active_coverage IN ('complete', 'partial')
        AND qualified_view) AS qualified_playbacks,
      coalesce(sum(active_playback_milliseconds) FILTER (
        WHERE usable AND active_coverage IN ('complete', 'partial')), 0)::bigint AS active_playback_milliseconds
    FROM (
      SELECT episode.id, episode.state, episode.hard_until,
        episode.conflict_count = 0 AND episode.generation = request.generation
          AND (outcome.id IS NULL OR outcome.generation = episode.generation) AS valid_episode,
        episode.conflict_count = 0 AND episode.generation = request.generation
          AND outcome.generation = episode.generation
          AND outcome.active_playback_milliseconds >= 0 AS usable,
        outcome.id AS outcome_id, outcome.qualified_view,
        outcome.active_coverage, outcome.active_playback_milliseconds
      FROM recommendation_precomputed_visit_request link
      JOIN recommendation_request request ON request.id = link.request_id
      JOIN recommendation_selection selection ON selection.request_id = request.id
        AND selection.received_at >= link.created_at
        AND selection.received_at <= LEAST(${asOf}, v.expires_at,
          experiment.ends_at + COALESCE(policy.late_event_cutoff_hours, 672) * interval '1 hour')
      JOIN recommendation_playback_episode episode ON episode.selection_id = selection.id
        AND episode.request_id = selection.request_id AND episode.item_id = selection.item_id
        AND episode.claimed_at >= selection.received_at
        AND episode.claimed_at <= LEAST(${asOf}, v.expires_at,
          experiment.ends_at + COALESCE(policy.late_event_cutoff_hours, 672) * interval '1 hour')
        AND episode.discovery_source = 'recommendation'
      LEFT JOIN LATERAL (
        SELECT candidate.*
        FROM recommendation_outcome_revision candidate
        WHERE candidate.episode_id = episode.id
          AND candidate.request_id = episode.request_id AND candidate.item_id = episode.item_id
          AND candidate.classifier_version = 'active-watch-proxy-v1'
          AND candidate.created_at <= LEAST(${asOf}, v.expires_at,
            experiment.ends_at + COALESCE(policy.late_event_cutoff_hours, 672) * interval '1 hour')
        ORDER BY candidate.revision DESC LIMIT 1
      ) outcome ON true
      WHERE link.visit_id = v.id
    ) playbacks
  `
}

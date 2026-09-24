import { Prisma, type PrismaClient } from "@prisma/client"
import type { RecommendationOpsWindow } from "./shared"

type WindowRow = Readonly<{
  deviceClass: string
  networkClass: string
  episodes: number
  v2Summaries: number
  attempts: number
  starts: number
  finalized: number
  outcomes: number
  navigationObserved: number
  navigationV2Observed: number
  navigationPartial: number
  qoeObserved: number
  qoeV2Observed: number
  qoePartial: number
  manualSkips: number
  autoplayTransitions: number
  userPauses: number
  startupTimeouts: number
  bufferingEpisodes: number
  fatalErrors: number
}>

export type PlaybackObservationWindow = Readonly<{
  episodes: number
  v2Summaries: number
  attempts: number
  starts: number
  finalized: number
  outcomes: number
  navigation: Readonly<{
    observed: number
    v2Observed: number
    legacyObserved: number
    partial: number
    missing: number
    manualSkips: number
    autoplayTransitions: number
    userPauses: number
  }>
  qoe: Readonly<{
    observed: number
    v2Observed: number
    legacyObserved: number
    partial: number
    missing: number
    startupTimeouts: number
    bufferingEpisodes: number
    fatalErrors: number
  }>
  breakdowns: ReadonlyArray<WindowRow>
}>

/** One full-window aggregate; no per-episode facts or raw identity leave SQL. */
export async function loadPlaybackObservationWindow(
  prisma: Pick<PrismaClient, "$queryRaw">,
  window: RecommendationOpsWindow,
  now: Date,
): Promise<PlaybackObservationWindow> {
  const rows = await prisma.$queryRaw<WindowRow[]>(Prisma.sql`
    WITH episode_facts AS MATERIALIZED (
      SELECT
        episode.id,
        episode.state::text AS state,
        episode.conflict_count AS conflicts,
        count(*) FILTER (WHERE fact.kind = 'playback_attempt')::integer AS attempts,
        count(*) FILTER (WHERE fact.kind = 'playback_start')::integer AS starts,
        count(*) FILTER (WHERE fact.kind = 'playback_error')::integer AS errors,
        count(*) FILTER (WHERE fact.kind = 'playback_seek')::integer AS seeks,
        count(*) FILTER (WHERE fact.kind = 'playback_navigation')::integer AS navigation_facts,
        count(*) FILTER (WHERE fact.kind = 'playback_qoe')::integer AS qoe_facts,
        count(*) FILTER (WHERE fact.kind = 'playback_navigation' AND fact.payload->>'action' = 'manual_skip')::integer AS manual_skips,
        count(*) FILTER (WHERE fact.kind = 'playback_navigation' AND fact.payload->>'action' = 'autoplay_transition')::integer AS autoplay_transitions,
        count(*) FILTER (WHERE fact.kind = 'playback_navigation' AND fact.payload->>'action' = 'pause' AND fact.payload->>'cause' = 'user')::integer AS user_pauses,
        count(*) FILTER (WHERE fact.kind = 'playback_qoe' AND fact.payload->>'action' = 'startup_timeout')::integer AS startup_timeouts,
        count(*) FILTER (WHERE fact.kind = 'playback_qoe' AND fact.payload->>'action' IN ('waiting', 'stalled'))::integer AS buffering_episodes,
        count(*) FILTER (WHERE fact.kind = 'playback_qoe' AND fact.payload->>'action' = 'media_error' AND fact.payload->>'severity' = 'fatal')::integer AS fatal_errors,
        (array_agg(fact.payload ORDER BY fact.sequence)
          FILTER (WHERE fact.kind = 'playback_observation'))[1] AS summary_payload,
        episode.next_fact_sequence,
        episode.generation
      FROM recommendation_playback_episode episode
      LEFT JOIN recommendation_playback_fact fact
        ON fact.episode_id = episode.id AND fact.expires_at > ${now}
      WHERE episode.created_at >= ${window.start}
        AND episode.created_at < ${window.end}
        AND episode.expires_at > ${now}
      GROUP BY episode.id
    ), summarized AS (
      SELECT summarized_episode.*,
        summary_payload->>'version' AS version,
        summary_payload->>'navigationCount' AS expected_navigation,
        summary_payload->>'seekCount' AS expected_seeks,
        summary_payload->>'qoeCount' AS expected_qoe,
        summary_payload->>'startObserved' AS expected_start,
        summary_payload->>'errorObserved' AS expected_error,
        summary_payload->>'deviceClass' AS raw_device,
        summary_payload->>'networkClass' AS raw_network,
        summarized_episode.state IN ('finalized', 'timed_out')
          AND outcome.id IS NOT NULL
          AND outcome.fact_watermark = summarized_episode.next_fact_sequence - 1
          AND outcome.generation = summarized_episode.generation
          AND outcome.expires_at > ${now} AS has_outcome
      FROM episode_facts summarized_episode
      LEFT JOIN LATERAL (
        SELECT active.id, active.fact_watermark, active.generation, active.expires_at
        FROM recommendation_outcome_revision active
        WHERE active.episode_id = summarized_episode.id
          AND active.classifier_version = 'active-watch-proxy-v1'
        ORDER BY active.revision DESC
        LIMIT 1
      ) outcome ON true
    ), classified AS (
      SELECT *,
        version IN ('playback-observations-v1', 'playback-observations-v2') AS has_summary,
        version IN ('playback-observations-v1', 'playback-observations-v2')
          AND conflicts = 0
          AND expected_navigation ~ '^[0-9]{1,5}$'
          AND expected_seeks ~ '^[0-9]{1,5}$'
          AND (CASE WHEN expected_navigation ~ '^[0-9]{1,5}$' THEN expected_navigation::integer END) = navigation_facts
          AND (CASE WHEN expected_seeks ~ '^[0-9]{1,5}$' THEN expected_seeks::integer END) = seeks AS navigation_observed,
        version IN ('playback-observations-v1', 'playback-observations-v2')
          AND conflicts = 0
          AND expected_qoe ~ '^[0-9]{1,5}$'
          AND (CASE WHEN expected_qoe ~ '^[0-9]{1,5}$' THEN expected_qoe::integer END) = qoe_facts
          AND expected_start = (starts > 0)::text
          AND expected_error = (errors > 0)::text AS qoe_observed,
        CASE WHEN raw_device IN ('mobile', 'desktop') THEN raw_device ELSE 'unknown' END AS "deviceClass",
        CASE WHEN raw_network IN ('slow-2g', '2g', '3g', '4g') THEN raw_network ELSE 'unknown' END AS "networkClass"
      FROM summarized
    )
    SELECT
      "deviceClass",
      "networkClass",
      count(*)::integer AS episodes,
      count(*) FILTER (WHERE version = 'playback-observations-v2')::integer AS "v2Summaries",
      count(*) FILTER (WHERE attempts > 0)::integer AS attempts,
      count(*) FILTER (WHERE starts > 0)::integer AS starts,
      count(*) FILTER (WHERE state IN ('finalized', 'timed_out'))::integer AS finalized,
      count(*) FILTER (WHERE has_outcome)::integer AS outcomes,
      count(*) FILTER (WHERE navigation_observed)::integer AS "navigationObserved",
      count(*) FILTER (WHERE navigation_observed AND version = 'playback-observations-v2')::integer AS "navigationV2Observed",
      count(*) FILTER (WHERE has_summary AND NOT coalesce(navigation_observed, false))::integer AS "navigationPartial",
      count(*) FILTER (WHERE qoe_observed)::integer AS "qoeObserved",
      count(*) FILTER (WHERE qoe_observed AND version = 'playback-observations-v2')::integer AS "qoeV2Observed",
      count(*) FILTER (WHERE has_summary AND NOT coalesce(qoe_observed, false))::integer AS "qoePartial",
      count(*) FILTER (WHERE manual_skips > 0)::integer AS "manualSkips",
      count(*) FILTER (WHERE autoplay_transitions > 0)::integer AS "autoplayTransitions",
      count(*) FILTER (WHERE user_pauses > 0)::integer AS "userPauses",
      count(*) FILTER (WHERE startup_timeouts > 0)::integer AS "startupTimeouts",
      count(*) FILTER (WHERE buffering_episodes > 0)::integer AS "bufferingEpisodes",
      count(*) FILTER (WHERE fatal_errors > 0)::integer AS "fatalErrors"
    FROM classified
    GROUP BY "deviceClass", "networkClass"
    ORDER BY "deviceClass", "networkClass"
  `)
  const total = (key: keyof WindowRow) =>
    rows.reduce((sum, row) => sum + Number(row[key]), 0)
  const episodes = total("episodes")
  const navigationObserved = total("navigationObserved")
  const navigationV2Observed = total("navigationV2Observed")
  const navigationPartial = total("navigationPartial")
  const qoeObserved = total("qoeObserved")
  const qoeV2Observed = total("qoeV2Observed")
  const qoePartial = total("qoePartial")
  return {
    episodes,
    v2Summaries: total("v2Summaries"),
    attempts: total("attempts"),
    starts: total("starts"),
    finalized: total("finalized"),
    outcomes: total("outcomes"),
    navigation: {
      observed: navigationObserved,
      v2Observed: navigationV2Observed,
      legacyObserved: navigationObserved - navigationV2Observed,
      partial: navigationPartial,
      missing: episodes - navigationObserved - navigationPartial,
      manualSkips: total("manualSkips"),
      autoplayTransitions: total("autoplayTransitions"),
      userPauses: total("userPauses"),
    },
    qoe: {
      observed: qoeObserved,
      v2Observed: qoeV2Observed,
      legacyObserved: qoeObserved - qoeV2Observed,
      partial: qoePartial,
      missing: episodes - qoeObserved - qoePartial,
      startupTimeouts: total("startupTimeouts"),
      bufferingEpisodes: total("bufferingEpisodes"),
      fatalErrors: total("fatalErrors"),
    },
    breakdowns: rows,
  }
}

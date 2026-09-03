import { Prisma, type PrismaClient } from "@prisma/client"
import { ACTIVE_WATCH_PROXY_VERSION } from "../contracts"
import {
  RECOMMENDATION_OPS_DAY_MS,
  RECOMMENDATION_TRACE_ACCESS_REASON,
  RECOMMENDATION_TRACE_ACCESS_RETENTION_DAYS,
  boundedRecommendationActorDigest,
  boundedRecommendationIdentifier,
  resolveRecommendationOpsWindow,
  type RecommendationOpsWindow,
} from "./shared"

type PlaybackOverviewRow = Readonly<{
  episodeCount: bigint | number
  finalizedCount: bigint | number
  factCount: bigint | number
  outcomeCount: bigint | number
  sourceCounts: unknown
}>

type RecentPlaybackRow = Readonly<{
  id: string
  mediaId: string
  discoverySource: string
  state: string
  factWatermark: number | null
  activePlaybackMilliseconds: number | null
  activeCoverage: string | null
  latestRevision: number | null
  finalizedAt: Date | null
  createdAt: Date
}>

export type PlaybackEvidenceOverview = Readonly<{
  window: RecommendationOpsWindow
  counts: Readonly<{
    episodes: number
    finalized: number
    facts: number
    outcomes: number
  }>
  sourceCounts: Array<Readonly<{ source: string; count: number }>>
  latestEvaluation: Readonly<{
    revision: number
    proxyVersion: string
    windowStart: Date
    windowEnd: Date
    sampleCount: number
    pairedCount: number
    missingCount: number
    agreementRate: number | null
    activeQualifiedRate: number | null
    legacyQualifiedRate: number | null
    lateRevisionRate: number | null
    finalizationLagP95Ms: number | null
    durationCohorts: Readonly<Record<string, number>>
    decision: string
    reasonCodes: string[]
    rankingInfluence: false
    inputDigest: string
    createdAt: Date
  }> | null
  recent: RecentPlaybackRow[]
}>

export type PlaybackEpisodeDetail = Readonly<{
  id: string
  requestId: string | null
  itemId: string | null
  selectionId: string | null
  contextVersion: string
  discoverySource: string
  provenance: Readonly<Record<string, string>>
  mediaId: string
  state: string
  generation: number
  nextFactSequence: number
  replayCount: number
  conflictCount: number
  activeUntil: Date
  hardUntil: Date
  claimedAt: Date | null
  finalizedAt: Date | null
  createdAt: Date
  expiresAt: Date
  facts: Array<
    Readonly<{
      id: string
      sequence: number
      eventId: string
      kind: string
      payloadDigest: string
      occurredAt: Date
      receivedAt: Date
      late: boolean
      activeMilliseconds: number | null
      activeCoverage: string | null
      positionSeconds: number | null
      durationSeconds: number | null
    }>
  >
  outcomes: Array<
    Readonly<{
      id: string
      classifierVersion: string
      revision: number
      supersedesId: string | null
      factWatermark: number
      inputDigest: string
      qualifiedView: boolean
      viewQualityWeight: number | null
      viewQualityWeightReason: string | null
      activePlaybackMilliseconds: number | null
      durationSeconds: number | null
      durationCohort: string | null
      activeCoverage: string | null
      activeIntervals: unknown
      reasons: string[]
      generation: number
      createdAt: Date
      finalizationLagMilliseconds: number
    }>
  >
}>

export async function loadPlaybackEvidenceOverview(
  prisma: PrismaClient,
  input: { window?: string | string[]; now?: Date } = {},
): Promise<PlaybackEvidenceOverview> {
  const now = input.now ?? new Date()
  const window = resolveRecommendationOpsWindow(input.window, now)
  const [rows, recent, evaluation] = await Promise.all([
    prisma.$queryRaw<PlaybackOverviewRow[]>(Prisma.sql`
      WITH episodes AS (
        SELECT id, state, discovery_source
        FROM recommendation_playback_episode
        WHERE created_at >= ${window.start}
          AND created_at < ${window.end}
          AND expires_at > ${now}
      ), source_counts AS (
        SELECT discovery_source, count(*)::integer AS count
        FROM episodes
        GROUP BY discovery_source
      )
      SELECT
        count(*) AS "episodeCount",
        count(*) FILTER (WHERE state IN ('finalized', 'timed_out')) AS "finalizedCount",
        (SELECT count(*) FROM recommendation_playback_fact fact
          JOIN episodes episode ON episode.id = fact.episode_id) AS "factCount",
        (SELECT count(*) FROM recommendation_outcome_revision outcome
          JOIN episodes episode ON episode.id = outcome.episode_id) AS "outcomeCount",
        COALESCE((SELECT jsonb_object_agg(discovery_source, count)
          FROM source_counts), '{}'::jsonb) AS "sourceCounts"
      FROM episodes
    `),
    prisma.$queryRaw<RecentPlaybackRow[]>(Prisma.sql`
      SELECT
        episode.id,
        episode.media_id AS "mediaId",
        episode.discovery_source AS "discoverySource",
        episode.state::text AS state,
        active.fact_watermark AS "factWatermark",
        active.active_playback_milliseconds AS "activePlaybackMilliseconds",
        active.active_coverage AS "activeCoverage",
        active.revision AS "latestRevision",
        episode.finalized_at AS "finalizedAt",
        episode.created_at AS "createdAt"
      FROM recommendation_playback_episode episode
      LEFT JOIN LATERAL (
        SELECT outcome.*
        FROM recommendation_outcome_revision outcome
        WHERE outcome.episode_id = episode.id
          AND outcome.classifier_version = ${ACTIVE_WATCH_PROXY_VERSION}
        ORDER BY outcome.revision DESC
        LIMIT 1
      ) active ON true
      WHERE episode.created_at >= ${window.start}
        AND episode.created_at < ${window.end}
        AND episode.expires_at > ${now}
      ORDER BY episode.created_at DESC, episode.id DESC
      LIMIT 20
    `),
    prisma.playbackProxyEvaluation.findFirst({
      where: { proxyVersion: ACTIVE_WATCH_PROXY_VERSION },
      orderBy: [{ revision: "desc" }, { createdAt: "desc" }],
    }),
  ])
  const row = rows[0]
  const sourceCounts = jsonNumberRecord(row?.sourceCounts)
  return {
    window,
    counts: {
      episodes: numericCount(row?.episodeCount),
      finalized: numericCount(row?.finalizedCount),
      facts: numericCount(row?.factCount),
      outcomes: numericCount(row?.outcomeCount),
    },
    sourceCounts: Object.entries(sourceCounts)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source)),
    latestEvaluation: evaluation
      ? {
          ...evaluation,
          durationCohorts: jsonNumberRecord(evaluation.durationCohorts),
          rankingInfluence: false,
        }
      : null,
    recent,
  }
}

export async function loadPlaybackEpisodeDetail(
  prisma: PrismaClient,
  input: { episodeId: string; actorDigest: string; now?: Date },
): Promise<PlaybackEpisodeDetail | null> {
  if (!boundedRecommendationIdentifier.test(input.episodeId)) return null
  if (!boundedRecommendationActorDigest.test(input.actorDigest)) return null
  const now = input.now ?? new Date()
  const auditExpiresAt = new Date(
    now.getTime() +
      RECOMMENDATION_TRACE_ACCESS_RETENTION_DAYS * RECOMMENDATION_OPS_DAY_MS,
  )
  return prisma.$transaction(async (tx) => {
    const episode = await tx.recommendationPlaybackEpisode.findFirst({
      where: { id: input.episodeId, expiresAt: { gt: now } },
      select: {
        id: true,
        requestId: true,
        itemId: true,
        selectionId: true,
        contextVersion: true,
        discoverySource: true,
        provenance: true,
        mediaId: true,
        state: true,
        generation: true,
        nextFactSequence: true,
        replayCount: true,
        conflictCount: true,
        activeUntil: true,
        hardUntil: true,
        claimedAt: true,
        finalizedAt: true,
        createdAt: true,
        expiresAt: true,
      },
    })
    if (!episode) return null
    const [facts, outcomes] = await Promise.all([
      tx.$queryRaw<PlaybackEpisodeDetail["facts"]>(Prisma.sql`
        SELECT
          id, sequence, event_id AS "eventId", kind,
          payload_digest AS "payloadDigest",
          occurred_at AS "occurredAt", received_at AS "receivedAt", late,
          CASE WHEN kind = 'playback_active_visible_playing'
            THEN (payload ->> 'activeMilliseconds')::integer END AS "activeMilliseconds",
          CASE WHEN kind = 'playback_active_visible_playing'
            THEN left(payload ->> 'coverage', 16) END AS "activeCoverage",
          CASE WHEN payload ? 'positionSeconds'
            THEN (payload ->> 'positionSeconds')::double precision END AS "positionSeconds",
          CASE WHEN payload ? 'durationSeconds' AND payload ->> 'durationSeconds' IS NOT NULL
            THEN (payload ->> 'durationSeconds')::double precision END AS "durationSeconds"
        FROM recommendation_playback_fact
        WHERE episode_id = ${episode.id}
          AND expires_at > ${now}
        ORDER BY sequence ASC
      `),
      tx.$queryRaw<PlaybackEpisodeDetail["outcomes"]>(Prisma.sql`
        SELECT
          id, classifier_version AS "classifierVersion", revision,
          supersedes_id AS "supersedesId", fact_watermark AS "factWatermark",
          input_digest AS "inputDigest", qualified_view AS "qualifiedView",
          view_quality_weight AS "viewQualityWeight",
          view_quality_weight_reason AS "viewQualityWeightReason",
          active_playback_milliseconds AS "activePlaybackMilliseconds",
          duration_seconds AS "durationSeconds", duration_cohort AS "durationCohort",
          active_coverage AS "activeCoverage", active_intervals AS "activeIntervals",
          reasons, generation, created_at AS "createdAt",
          greatest(0, extract(epoch FROM (created_at - ${episode.createdAt})) * 1000)::integer
            AS "finalizationLagMilliseconds"
        FROM recommendation_outcome_revision
        WHERE episode_id = ${episode.id}
          AND expires_at > ${now}
        ORDER BY classifier_version ASC, revision ASC
      `),
    ])
    await tx.recommendationTraceAccessAudit.create({
      data: {
        requestId: episode.requestId,
        episodeId: episode.id,
        actorDigest: input.actorDigest,
        reasonCode: RECOMMENDATION_TRACE_ACCESS_REASON,
        accessedAt: now,
        expiresAt: auditExpiresAt,
      },
    })
    return {
      ...episode,
      state: episode.state.toLowerCase(),
      provenance: stringRecord(episode.provenance),
      facts,
      outcomes,
    }
  })
}

function numericCount(value: bigint | number | null | undefined): number {
  if (typeof value === "bigint") return Number(value)
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function jsonNumberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      typeof entry === "number" && Number.isFinite(entry) ? [[key, entry]] : [],
    ),
  )
}

function stringRecord(value: unknown): Readonly<Record<string, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      typeof entry === "string" ? [[key, entry]] : [],
    ),
  )
}

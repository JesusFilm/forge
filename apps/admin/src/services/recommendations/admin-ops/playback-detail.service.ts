import { Prisma, type PrismaClient } from "@prisma/client"
import type { RecommendationPlaybackSource } from "../contracts"
import {
  RECOMMENDATION_OPS_DAY_MS,
  RECOMMENDATION_TRACE_ACCESS_REASON,
  RECOMMENDATION_TRACE_ACCESS_RETENTION_DAYS,
  RECOMMENDATION_TRACE_PAGE_SIZE,
  boundedRecommendationActorDigest,
  boundedRecommendationIdentifier,
  resolveRecommendationOpsWindow,
  type RecommendationOpsWindow,
} from "./shared"

export type RecommendationPlaybackTraceRow = Readonly<{
  id: string
  source: RecommendationPlaybackSource
  mediaId: string
  recommendationAttributed: boolean
  sourceReferencePresent: boolean
  generation: number
  createdAt: Date
  expiresAt: Date
  episode: Readonly<{
    id: string
    state: "pending" | "claimed" | "finalized" | "timed_out"
    generation: number
    claimedAt: Date | null
    finalizedAt: Date | null
    activeUntil: Date
    hardUntil: Date
    facts: number
    outcomes: number
  }> | null
  conflicts: number
  writeFailures: number
}>

export type RecommendationPlaybackTracePageData = Readonly<{
  window: RecommendationOpsWindow
  rows: RecommendationPlaybackTraceRow[]
}>

type PlaybackTraceRow = Readonly<{
  id: string
  source: RecommendationPlaybackTraceRow["source"]
  mediaId: string
  recommendationAttributed: boolean
  sourceReferencePresent: boolean
  generation: number
  createdAt: Date
  expiresAt: Date
  episodeId: string | null
  episodeState: "pending" | "claimed" | "finalized" | "timed_out" | null
  episodeGeneration: number | null
  claimedAt: Date | null
  finalizedAt: Date | null
  activeUntil: Date | null
  hardUntil: Date | null
  factCount: bigint
  outcomeCount: bigint
  conflictCount: bigint
  writeFailureCount: bigint
}>

export async function loadRecommendationPlaybackTracePage(
  prisma: PrismaClient,
  input: { window?: string | string[]; now?: Date } = {},
): Promise<RecommendationPlaybackTracePageData> {
  const now = input.now ?? new Date()
  const window = resolveRecommendationOpsWindow(input.window, now)
  const rows = await prisma.$queryRaw<PlaybackTraceRow[]>(Prisma.sql`
    SELECT
      context.id,
      context.source::text AS source,
      context.media_id AS "mediaId",
      context.request_id IS NOT NULL AS "recommendationAttributed",
      context.source_ref_digest IS NOT NULL AS "sourceReferencePresent",
      context.generation,
      context.created_at AS "createdAt",
      context.expires_at AS "expiresAt",
      episode.id AS "episodeId",
      episode.state::text AS "episodeState",
      episode.generation AS "episodeGeneration",
      episode.claimed_at AS "claimedAt",
      episode.finalized_at AS "finalizedAt",
      episode.active_until AS "activeUntil",
      episode.hard_until AS "hardUntil",
      COALESCE(facts.count, 0)::bigint AS "factCount",
      COALESCE(outcomes.count, 0)::bigint AS "outcomeCount",
      COALESCE(conflicts.count, 0)::bigint AS "conflictCount",
      COALESCE(failures.count, 0)::bigint AS "writeFailureCount"
    FROM recommendation_playback_context context
    LEFT JOIN recommendation_playback_episode episode
      ON episode.context_id = context.id
    LEFT JOIN LATERAL (
      SELECT count(*) AS count
      FROM recommendation_playback_fact fact
      WHERE fact.episode_id = episode.id
    ) facts ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS count
      FROM recommendation_outcome_revision outcome
      WHERE outcome.episode_id = episode.id
    ) outcomes ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS count
      FROM recommendation_conflict conflict
      WHERE conflict.context_id = context.id
    ) conflicts ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS count
      FROM recommendation_evidence_audit audit
      WHERE audit.context_id = context.id
        AND audit.kind = 'write_failure'
    ) failures ON true
    WHERE context.created_at >= ${window.start}
      AND context.created_at < ${window.end}
      AND context.expires_at > ${now}
    ORDER BY context.created_at DESC, context.id DESC
    LIMIT ${RECOMMENDATION_TRACE_PAGE_SIZE}
  `)
  return {
    window,
    rows: rows.map(mapPlaybackTraceRow),
  }
}

export type RecommendationPlaybackFactDetail = Readonly<{
  sequence: number
  kind: string
  occurredAt: Date
  receivedAt: Date
  late: boolean
  positionSeconds: number | null
  durationSeconds: number | null
  fromSeconds: number | null
  toSeconds: number | null
  activeMilliseconds: number | null
  startedAt: string | null
  endedAt: string | null
}>

export type RecommendationPlaybackOutcomeDetail = Readonly<{
  classifierVersion: string
  revision: number
  qualifiedView: boolean
  viewQualityWeight: number | null
  viewQualityWeightReason: string | null
  activePlaybackMilliseconds: number | null
  durationSeconds: number | null
  durationCohort: string | null
  activeCoverage: string | null
  reasons: string[]
  generation: number
  createdAt: Date
  eligibility: Readonly<{
    state: string
    actorClass: string
    eligibleScopes: string[]
    contributionWeight: number
    reasonCodes: string[]
  }> | null
}>

export type RecommendationPlaybackContextDetailData = Readonly<{
  context: RecommendationPlaybackTraceRow
  facts: RecommendationPlaybackFactDetail[]
  outcomes: RecommendationPlaybackOutcomeDetail[]
  audits: ReadonlyArray<
    Readonly<{
      kind: string
      reasonCode: string
      count: number
      occurredAt: Date
    }>
  >
  conflicts: ReadonlyArray<
    Readonly<{
      attempts: number
      firstSeenAt: Date
      lastSeenAt: Date
    }>
  >
}>

type PlaybackFactDetailRow = RecommendationPlaybackFactDetail
type PlaybackOutcomeDetailRow = Omit<
  RecommendationPlaybackOutcomeDetail,
  "eligibility"
> & {
  eligibilityState: string | null
  actorClass: string | null
  eligibleScopes: string[] | null
  contributionWeight: number | null
  eligibilityReasonCodes: string[] | null
}

export async function loadRecommendationPlaybackContextDetail(
  prisma: PrismaClient,
  input: { contextId: string; actorDigest: string; now?: Date },
): Promise<RecommendationPlaybackContextDetailData | null> {
  if (!boundedRecommendationIdentifier.test(input.contextId)) return null
  if (!boundedRecommendationActorDigest.test(input.actorDigest)) return null
  const now = input.now ?? new Date()
  const auditExpiresAt = new Date(
    now.getTime() +
      RECOMMENDATION_TRACE_ACCESS_RETENTION_DAYS * RECOMMENDATION_OPS_DAY_MS,
  )
  return prisma.$transaction(
    async (tx) => {
      const contexts = await tx.$queryRaw<PlaybackTraceRow[]>(Prisma.sql`
        SELECT
          context.id,
          context.source::text AS source,
          context.media_id AS "mediaId",
          context.request_id IS NOT NULL AS "recommendationAttributed",
          context.source_ref_digest IS NOT NULL AS "sourceReferencePresent",
          context.generation,
          context.created_at AS "createdAt",
          context.expires_at AS "expiresAt",
          episode.id AS "episodeId",
          episode.state::text AS "episodeState",
          episode.generation AS "episodeGeneration",
          episode.claimed_at AS "claimedAt",
          episode.finalized_at AS "finalizedAt",
          episode.active_until AS "activeUntil",
          episode.hard_until AS "hardUntil",
          COALESCE(facts.count, 0)::bigint AS "factCount",
          COALESCE(outcomes.count, 0)::bigint AS "outcomeCount",
          COALESCE(conflicts.count, 0)::bigint AS "conflictCount",
          COALESCE(failures.count, 0)::bigint AS "writeFailureCount"
        FROM recommendation_playback_context context
        LEFT JOIN recommendation_playback_episode episode
          ON episode.context_id = context.id
        LEFT JOIN LATERAL (
          SELECT count(*) AS count FROM recommendation_playback_fact fact
          WHERE fact.episode_id = episode.id
        ) facts ON true
        LEFT JOIN LATERAL (
          SELECT count(*) AS count FROM recommendation_outcome_revision outcome
          WHERE outcome.episode_id = episode.id
        ) outcomes ON true
        LEFT JOIN LATERAL (
          SELECT count(*) AS count FROM recommendation_conflict conflict
          WHERE conflict.context_id = context.id
        ) conflicts ON true
        LEFT JOIN LATERAL (
          SELECT count(*) AS count FROM recommendation_evidence_audit audit
          WHERE audit.context_id = context.id AND audit.kind = 'write_failure'
        ) failures ON true
        WHERE context.id = ${input.contextId}
          AND context.expires_at > ${now}
        LIMIT 1
      `)
      const context = contexts[0]
      if (!context) return null

      const [facts, outcomeRows, audits, conflicts] = await Promise.all([
        tx.$queryRaw<PlaybackFactDetailRow[]>(Prisma.sql`
          SELECT
            fact.sequence,
            left(fact.kind, 64) AS kind,
            fact.occurred_at AS "occurredAt",
            fact.received_at AS "receivedAt",
            fact.late,
            CASE WHEN jsonb_typeof(fact.payload -> 'positionSeconds') = 'number'
              THEN (fact.payload ->> 'positionSeconds')::double precision END AS "positionSeconds",
            CASE WHEN jsonb_typeof(fact.payload -> 'durationSeconds') = 'number'
              THEN (fact.payload ->> 'durationSeconds')::double precision END AS "durationSeconds",
            CASE WHEN jsonb_typeof(fact.payload -> 'fromSeconds') = 'number'
              THEN (fact.payload ->> 'fromSeconds')::double precision END AS "fromSeconds",
            CASE WHEN jsonb_typeof(fact.payload -> 'toSeconds') = 'number'
              THEN (fact.payload ->> 'toSeconds')::double precision END AS "toSeconds",
            CASE WHEN jsonb_typeof(fact.payload -> 'activeMilliseconds') = 'number'
              THEN (fact.payload ->> 'activeMilliseconds')::integer END AS "activeMilliseconds",
            CASE WHEN jsonb_typeof(fact.payload -> 'startedAt') = 'string'
              THEN left(fact.payload ->> 'startedAt', 32) END AS "startedAt",
            CASE WHEN jsonb_typeof(fact.payload -> 'endedAt') = 'string'
              THEN left(fact.payload ->> 'endedAt', 32) END AS "endedAt"
          FROM recommendation_playback_fact fact
          WHERE fact.episode_id = ${context.episodeId}
            AND fact.expires_at > ${now}
          ORDER BY fact.sequence ASC
          LIMIT 256
        `),
        tx.$queryRaw<PlaybackOutcomeDetailRow[]>(Prisma.sql`
          SELECT
            left(outcome.classifier_version, 64) AS "classifierVersion",
            outcome.revision,
            outcome.qualified_view AS "qualifiedView",
            outcome.view_quality_weight AS "viewQualityWeight",
            left(outcome.view_quality_weight_reason, 64) AS "viewQualityWeightReason",
            outcome.active_playback_milliseconds AS "activePlaybackMilliseconds",
            outcome.duration_seconds AS "durationSeconds",
            left(outcome.duration_cohort, 16) AS "durationCohort",
            left(outcome.active_coverage, 16) AS "activeCoverage",
            outcome.reasons,
            outcome.generation,
            outcome.created_at AS "createdAt",
            eligibility.state::text AS "eligibilityState",
            eligibility.actor_class::text AS "actorClass",
            eligibility.eligible_scopes AS "eligibleScopes",
            eligibility.contribution_weight AS "contributionWeight",
            eligibility.reason_codes AS "eligibilityReasonCodes"
          FROM recommendation_outcome_revision outcome
          LEFT JOIN LATERAL (
            SELECT decision.*
            FROM recommendation_eligibility_decision decision
            WHERE decision.outcome_id = outcome.id
              AND decision.is_current = true
              AND decision.expires_at > ${now}
            ORDER BY decision.revision DESC
            LIMIT 1
          ) eligibility ON true
          WHERE outcome.episode_id = ${context.episodeId}
            AND outcome.expires_at > ${now}
          ORDER BY outcome.revision ASC, outcome.created_at ASC
          LIMIT 64
        `),
        tx.recommendationEvidenceAudit.findMany({
          where: { contextId: context.id, expiresAt: { gt: now } },
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
          take: 128,
          select: {
            kind: true,
            reasonCode: true,
            count: true,
            occurredAt: true,
          },
        }),
        tx.recommendationConflict.findMany({
          where: { contextId: context.id, expiresAt: { gt: now } },
          orderBy: [{ firstSeenAt: "asc" }, { id: "asc" }],
          take: 128,
          select: { attempts: true, firstSeenAt: true, lastSeenAt: true },
        }),
      ])
      await tx.recommendationTraceAccessAudit.create({
        data: {
          contextId: context.id,
          actorDigest: input.actorDigest,
          reasonCode: RECOMMENDATION_TRACE_ACCESS_REASON,
          accessedAt: now,
          expiresAt: auditExpiresAt,
        },
      })
      return {
        context: mapPlaybackTraceRow(context),
        facts,
        outcomes: outcomeRows.map((outcome) => ({
          classifierVersion: outcome.classifierVersion,
          revision: outcome.revision,
          qualifiedView: outcome.qualifiedView,
          viewQualityWeight: outcome.viewQualityWeight,
          viewQualityWeightReason: outcome.viewQualityWeightReason,
          activePlaybackMilliseconds: outcome.activePlaybackMilliseconds,
          durationSeconds: outcome.durationSeconds,
          durationCohort: outcome.durationCohort,
          activeCoverage: outcome.activeCoverage,
          reasons: outcome.reasons,
          generation: outcome.generation,
          createdAt: outcome.createdAt,
          eligibility:
            outcome.eligibilityState &&
            outcome.actorClass &&
            outcome.eligibleScopes &&
            outcome.contributionWeight != null &&
            outcome.eligibilityReasonCodes
              ? {
                  state: outcome.eligibilityState,
                  actorClass: outcome.actorClass,
                  eligibleScopes: outcome.eligibleScopes,
                  contributionWeight: outcome.contributionWeight,
                  reasonCodes: outcome.eligibilityReasonCodes,
                }
              : null,
        })),
        audits: audits.map((audit) => ({
          ...audit,
          kind: audit.kind.toLowerCase(),
        })),
        conflicts,
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  )
}

function mapPlaybackTraceRow(
  row: PlaybackTraceRow,
): RecommendationPlaybackTraceRow {
  return {
    id: row.id,
    source: row.source,
    mediaId: row.mediaId,
    recommendationAttributed: row.recommendationAttributed,
    sourceReferencePresent: row.sourceReferencePresent,
    generation: row.generation,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    episode:
      row.episodeId &&
      row.episodeState &&
      row.episodeGeneration != null &&
      row.activeUntil &&
      row.hardUntil
        ? {
            id: row.episodeId,
            state: row.episodeState,
            generation: row.episodeGeneration,
            claimedAt: row.claimedAt,
            finalizedAt: row.finalizedAt,
            activeUntil: row.activeUntil,
            hardUntil: row.hardUntil,
            facts: Number(row.factCount),
            outcomes: Number(row.outcomeCount),
          }
        : null,
    conflicts: Number(row.conflictCount),
    writeFailures: Number(row.writeFailureCount),
  }
}

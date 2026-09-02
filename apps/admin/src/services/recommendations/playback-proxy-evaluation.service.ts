import { randomUUID } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { recommendationEvidenceDigest } from "./evidence.service"
import { readRecommendationRetentionHealth } from "./retention.service"
import { withRecommendationSerializableRetry } from "./transaction-retry"

export const PLAYBACK_PROXY_MIN_TOTAL = 50
export const PLAYBACK_PROXY_MIN_COHORT = 10
export const PLAYBACK_PROXY_MIN_COMPLETE_COVERAGE = 0.95
export const PLAYBACK_PROXY_MAX_P95_LAG_MS = 15 * 60 * 1_000
export const PLAYBACK_PROXY_MAX_CONFLICT_RATE = 0.01
export const PLAYBACK_PROXY_MAX_REVISION_RATE = 0.1
const PLAYBACK_PROXY_RETENTION_DAYS = 365
const AGGREGATE_RETENTION_MS =
  PLAYBACK_PROXY_RETENTION_DAYS * 24 * 60 * 60 * 1_000

export type PlaybackProxyReadinessInput = Readonly<{
  finalizedTotal: number
  activeOutcomeTotal: number
  durationCohorts: Readonly<Record<string, number>>
  cohortComparisons: Readonly<
    Record<
      string,
      Readonly<{
        legacyQualified: number
        proxyQualified: number
        disagreements: number
      }>
    >
  >
  completeCoverage: number
  legacyQualifiedTotal: number
  proxyQualifiedTotal: number
  classificationDisagreements: number
  p95FinalizationLagMs: number | null
  conflictRate: number
  revisionRate: number
  retentionHealthy: boolean
  writeFailureCount: number
}>

export type PlaybackProxyReadiness = Readonly<{
  state: "inconclusive" | "revise" | "retire" | "eligible_for_shadow_evaluation"
  reasonCodes: string[]
}>

type PlaybackAggregateRow = Readonly<{
  finalizedTotal: bigint | number
  activeOutcomeTotal: bigint | number
  completeCoverage: bigint | number
  legacyQualifiedTotal: bigint | number
  proxyQualifiedTotal: bigint | number
  classificationDisagreements: bigint | number
  revisedOutcomeTotal: bigint | number
  contextTotal: bigint | number
  conflictedContextTotal: bigint | number
  writeFailureCount: bigint | number
  p95FinalizationLagMs: number | null
  inputWatermark: Date | null
}>

type PlaybackCohortRow = Readonly<{
  cohort: string
  count: bigint | number
  legacyQualified: bigint | number
  proxyQualified: bigint | number
  disagreements: bigint | number
}>

export function assessPlaybackProxyReadiness(
  input: PlaybackProxyReadinessInput,
): PlaybackProxyReadiness {
  if (!input.retentionHealthy || input.writeFailureCount > 0) {
    return { state: "revise", reasonCodes: ["operational_health_failed"] }
  }
  const qualityFailures = [
    ...(input.finalizedTotal > 0 &&
    input.completeCoverage / input.finalizedTotal <
      PLAYBACK_PROXY_MIN_COMPLETE_COVERAGE
      ? ["active_coverage_below_95_percent"]
      : []),
    ...(input.p95FinalizationLagMs != null &&
    input.p95FinalizationLagMs > PLAYBACK_PROXY_MAX_P95_LAG_MS
      ? ["finalization_lag_above_15_minutes"]
      : []),
    ...(input.conflictRate > PLAYBACK_PROXY_MAX_CONFLICT_RATE
      ? ["conflict_rate_above_1_percent"]
      : []),
    ...(input.revisionRate > PLAYBACK_PROXY_MAX_REVISION_RATE
      ? ["revision_rate_above_10_percent"]
      : []),
  ]
  if (qualityFailures.length > 0) {
    return { state: "revise", reasonCodes: qualityFailures }
  }
  if (input.p95FinalizationLagMs == null) {
    return { state: "inconclusive", reasonCodes: ["finalization_lag_missing"] }
  }
  if (
    input.finalizedTotal >= PLAYBACK_PROXY_MIN_TOTAL &&
    input.activeOutcomeTotal >= PLAYBACK_PROXY_MIN_TOTAL &&
    input.legacyQualifiedTotal >= PLAYBACK_PROXY_MIN_COHORT &&
    input.proxyQualifiedTotal === 0
  ) {
    return {
      state: "retire",
      reasonCodes: ["proxy_zero_signal_in_mature_legacy_positive_window"],
    }
  }
  const sparseCohorts = Object.entries(input.durationCohorts)
    .filter(([, count]) => count > 0 && count < PLAYBACK_PROXY_MIN_COHORT)
    .map(([cohort]) => `duration_cohort_${cohort}_below_10`)
  if (input.finalizedTotal < PLAYBACK_PROXY_MIN_TOTAL) {
    return {
      state: "inconclusive",
      reasonCodes: ["finalized_total_below_50", ...sparseCohorts],
    }
  }
  if (sparseCohorts.length > 0) {
    return { state: "inconclusive", reasonCodes: sparseCohorts }
  }
  return {
    state: "eligible_for_shadow_evaluation",
    reasonCodes: ["bounded_collection_quality_sufficient"],
  }
}

export async function publishPlaybackProxyEvaluation(
  prisma: PrismaClient,
  input: PlaybackProxyReadinessInput & {
    windowStart: Date
    windowEnd: Date
    inputWatermark: Date
    evaluatedAt?: Date
  },
) {
  const evaluatedAt = input.evaluatedAt ?? new Date()
  if (
    !Number.isFinite(input.windowStart.getTime()) ||
    !Number.isFinite(input.windowEnd.getTime()) ||
    !Number.isFinite(input.inputWatermark.getTime()) ||
    input.windowStart >= input.windowEnd ||
    input.inputWatermark > evaluatedAt
  ) {
    throw new Error("Playback proxy evaluation lifecycle is invalid")
  }
  const digestInput = { ...input }
  delete digestInput.evaluatedAt
  const inputDigest = recommendationEvidenceDigest(digestInput)
  const readiness = assessPlaybackProxyReadiness(input)
  return withRecommendationSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(Prisma.sql`
          SELECT pg_advisory_xact_lock(hashtextextended(
            'recommendation-playback-proxy-evaluation', 369
          ))
        `)
        const exact = await tx.recommendationPlaybackProxyEvaluation.findUnique(
          {
            where: {
              inputWatermark_inputDigest: {
                inputWatermark: input.inputWatermark,
                inputDigest,
              },
            },
          },
        )
        if (exact) return { status: "existing" as const, evaluation: exact }
        const latest = await tx.recommendationPlaybackProxyEvaluation.findFirst(
          {
            orderBy: [{ revision: "desc" }, { evaluatedAt: "desc" }],
          },
        )
        const evaluation =
          await tx.recommendationPlaybackProxyEvaluation.create({
            data: {
              id: randomUUID(),
              revision: (latest?.revision ?? 0) + 1,
              supersedesId: latest?.id ?? null,
              policyVersion: "active-watch-proxy-readiness-v1",
              windowStart: input.windowStart,
              windowEnd: input.windowEnd,
              inputWatermark: input.inputWatermark,
              inputDigest,
              state: readiness.state,
              reasonCodes: readiness.reasonCodes,
              counts: {
                finalizedTotal: input.finalizedTotal,
                activeOutcomeTotal: input.activeOutcomeTotal,
                completeCoverage: input.completeCoverage,
                writeFailureCount: input.writeFailureCount,
                legacyQualifiedTotal: input.legacyQualifiedTotal,
                proxyQualifiedTotal: input.proxyQualifiedTotal,
                classificationDisagreements: input.classificationDisagreements,
              },
              cohorts: Object.fromEntries(
                Object.entries(input.durationCohorts).map(([cohort, count]) => [
                  cohort,
                  {
                    total: count,
                    legacyQualified:
                      input.cohortComparisons[cohort]?.legacyQualified ?? 0,
                    proxyQualified:
                      input.cohortComparisons[cohort]?.proxyQualified ?? 0,
                    disagreements:
                      input.cohortComparisons[cohort]?.disagreements ?? 0,
                  },
                ]),
              ),
              metrics: {
                p95FinalizationLagMs: input.p95FinalizationLagMs,
                conflictRate: input.conflictRate,
                revisionRate: input.revisionRate,
                retentionHealthy: input.retentionHealthy,
              },
              deletionBehavior: "scheduled_expiry",
              fallbackBehavior: "no_serving_effect",
              retentionDays: PLAYBACK_PROXY_RETENTION_DAYS,
              evaluatedAt,
              expiresAt: new Date(
                evaluatedAt.getTime() + AGGREGATE_RETENTION_MS,
              ),
            },
          })
        return { status: "published" as const, evaluation }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  )
}

/**
 * Reconciles a repeatable-read window directly from immutable episode and
 * outcome records. Discovery source is intentionally absent from both the
 * query predicates and all readiness math.
 */
export async function evaluatePlaybackProxyReadiness(
  prisma: PrismaClient,
  input: { windowStart: Date; windowEnd: Date; now?: Date },
) {
  const capturedAt = input.now ?? new Date()
  if (
    !Number.isFinite(input.windowStart.getTime()) ||
    !Number.isFinite(input.windowEnd.getTime()) ||
    input.windowStart >= input.windowEnd ||
    input.windowEnd > capturedAt
  ) {
    throw new Error("Playback proxy evaluation window is invalid")
  }
  const [retention, snapshot] = await Promise.all([
    readRecommendationRetentionHealth(prisma, capturedAt),
    prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<PlaybackAggregateRow[]>(Prisma.sql`
          WITH scoped_contexts AS MATERIALIZED (
            SELECT context.id
            FROM recommendation_playback_context context
            WHERE context.created_at >= ${input.windowStart}
              AND context.created_at < ${input.windowEnd}
              AND context.created_at <= ${capturedAt}
          ),
          scoped_episodes AS MATERIALIZED (
            SELECT episode.*
            FROM recommendation_playback_episode episode
            JOIN scoped_contexts context ON context.id = episode.context_id
          ),
          due_episodes AS MATERIALIZED (
            SELECT episode.*
            FROM scoped_episodes episode
            WHERE episode.state IN ('finalized', 'timed_out')
              OR episode.active_until <= ${capturedAt}
          ),
          latest_active AS MATERIALIZED (
            SELECT outcome.*
            FROM recommendation_outcome_revision outcome
            JOIN due_episodes episode ON episode.id = outcome.episode_id
            WHERE outcome.classifier_version = 'active-watch-proxy-v1'
              AND outcome.created_at <= ${capturedAt}
              AND NOT EXISTS (
                SELECT 1 FROM recommendation_outcome_revision successor
                WHERE successor.supersedes_id = outcome.id
                  AND successor.created_at <= ${capturedAt}
              )
          ),
          latest_legacy AS MATERIALIZED (
            SELECT outcome.*
            FROM recommendation_outcome_revision outcome
            JOIN due_episodes episode ON episode.id = outcome.episode_id
            WHERE outcome.classifier_version = 'legacy-position-v0'
              AND outcome.created_at <= ${capturedAt}
              AND NOT EXISTS (
                SELECT 1 FROM recommendation_outcome_revision successor
                WHERE successor.supersedes_id = outcome.id
                  AND successor.created_at <= ${capturedAt}
              )
          ),
          outcome_pairs AS MATERIALIZED (
            SELECT
              episode.id AS episode_id,
              active.id AS active_id,
              active.qualified_view AS proxy_qualified,
              active.active_coverage,
              active.revision AS active_revision,
              active.created_at AS active_created_at,
              legacy.qualified_view AS legacy_qualified,
              legacy.created_at AS legacy_created_at,
              COALESCE(active.duration_cohort, 'unknown') AS duration_cohort,
              GREATEST(0, EXTRACT(EPOCH FROM (
                active.created_at - COALESCE(
                  (
                    SELECT max(fact.received_at)
                    FROM recommendation_playback_fact fact
                    WHERE fact.episode_id = episode.id
                      AND fact.received_at <= ${capturedAt}
                  ),
                  episode.claimed_at,
                  episode.created_at
                )
              )) * 1000)::double precision AS finalization_lag_ms
            FROM due_episodes episode
            LEFT JOIN latest_active active ON active.episode_id = episode.id
            LEFT JOIN latest_legacy legacy ON legacy.episode_id = episode.id
          ),
          conflict_contexts AS MATERIALIZED (
            SELECT DISTINCT conflict.context_id
            FROM recommendation_conflict conflict
            JOIN scoped_contexts context ON context.id = conflict.context_id
            WHERE conflict.last_seen_at <= ${capturedAt}
          )
          SELECT
            (SELECT count(*) FROM due_episodes) AS "finalizedTotal",
            count(active_id) AS "activeOutcomeTotal",
            count(*) FILTER (WHERE active_coverage = 'complete') AS "completeCoverage",
            count(*) FILTER (WHERE legacy_qualified = true) AS "legacyQualifiedTotal",
            count(*) FILTER (WHERE proxy_qualified = true) AS "proxyQualifiedTotal",
            count(*) FILTER (
              WHERE active_id IS NOT NULL
                AND legacy_qualified IS NOT NULL
                AND proxy_qualified IS DISTINCT FROM legacy_qualified
            ) AS "classificationDisagreements",
            count(*) FILTER (WHERE active_revision > 1) AS "revisedOutcomeTotal",
            (SELECT count(*) FROM scoped_contexts) AS "contextTotal",
            (SELECT count(*) FROM conflict_contexts) AS "conflictedContextTotal",
            (
              SELECT COALESCE(sum(audit.count), 0)
              FROM recommendation_evidence_audit audit
              JOIN scoped_contexts context ON context.id = audit.context_id
              WHERE audit.kind = 'write_failure'
                AND audit.occurred_at <= ${capturedAt}
            ) AS "writeFailureCount",
            percentile_cont(0.95) WITHIN GROUP (ORDER BY finalization_lag_ms)
              FILTER (WHERE active_id IS NOT NULL) AS "p95FinalizationLagMs",
            max(GREATEST(active_created_at, legacy_created_at))
              FILTER (WHERE active_id IS NOT NULL OR legacy_created_at IS NOT NULL)
              AS "inputWatermark"
          FROM outcome_pairs
        `)
        const cohorts = await tx.$queryRaw<PlaybackCohortRow[]>(Prisma.sql`
          WITH scoped_episodes AS MATERIALIZED (
            SELECT episode.id
            FROM recommendation_playback_context context
            JOIN recommendation_playback_episode episode
              ON episode.context_id = context.id
            WHERE context.created_at >= ${input.windowStart}
              AND context.created_at < ${input.windowEnd}
              AND context.created_at <= ${capturedAt}
              AND (
                episode.state IN ('finalized', 'timed_out')
                OR episode.active_until <= ${capturedAt}
              )
          ),
          latest_active AS MATERIALIZED (
            SELECT outcome.*
            FROM recommendation_outcome_revision outcome
            JOIN scoped_episodes episode ON episode.id = outcome.episode_id
            WHERE outcome.classifier_version = 'active-watch-proxy-v1'
              AND outcome.created_at <= ${capturedAt}
              AND NOT EXISTS (
                SELECT 1 FROM recommendation_outcome_revision successor
                WHERE successor.supersedes_id = outcome.id
                  AND successor.created_at <= ${capturedAt}
              )
          ),
          latest_legacy AS MATERIALIZED (
            SELECT outcome.*
            FROM recommendation_outcome_revision outcome
            JOIN scoped_episodes episode ON episode.id = outcome.episode_id
            WHERE outcome.classifier_version = 'legacy-position-v0'
              AND outcome.created_at <= ${capturedAt}
              AND NOT EXISTS (
                SELECT 1 FROM recommendation_outcome_revision successor
                WHERE successor.supersedes_id = outcome.id
                  AND successor.created_at <= ${capturedAt}
              )
          )
          SELECT
            COALESCE(active.duration_cohort, 'unknown') AS cohort,
            count(*) AS count,
            count(*) FILTER (WHERE legacy.qualified_view = true) AS "legacyQualified",
            count(*) FILTER (WHERE active.qualified_view = true) AS "proxyQualified",
            count(*) FILTER (
              WHERE legacy.qualified_view IS NOT NULL
                AND active.qualified_view IS DISTINCT FROM legacy.qualified_view
            ) AS disagreements
          FROM latest_active active
          LEFT JOIN latest_legacy legacy ON legacy.episode_id = active.episode_id
          GROUP BY COALESCE(active.duration_cohort, 'unknown')
          ORDER BY cohort
        `)
        return { row: rows[0], cohorts }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    ),
  ])
  if (!snapshot.row) throw new Error("Playback proxy aggregate row is missing")
  const row = snapshot.row
  const finalizedTotal = safeCount(row.finalizedTotal)
  const activeOutcomeTotal = safeCount(row.activeOutcomeTotal)
  const durationCohorts = Object.fromEntries(
    snapshot.cohorts.map((cohort) => [cohort.cohort, safeCount(cohort.count)]),
  )
  const cohortComparisons = Object.fromEntries(
    snapshot.cohorts.map((cohort) => [
      cohort.cohort,
      {
        legacyQualified: safeCount(cohort.legacyQualified),
        proxyQualified: safeCount(cohort.proxyQualified),
        disagreements: safeCount(cohort.disagreements),
      },
    ]),
  )
  return publishPlaybackProxyEvaluation(prisma, {
    finalizedTotal,
    activeOutcomeTotal,
    durationCohorts,
    cohortComparisons,
    completeCoverage: safeCount(row.completeCoverage),
    legacyQualifiedTotal: safeCount(row.legacyQualifiedTotal),
    proxyQualifiedTotal: safeCount(row.proxyQualifiedTotal),
    classificationDisagreements: safeCount(row.classificationDisagreements),
    p95FinalizationLagMs: row.p95FinalizationLagMs,
    conflictRate: ratio(
      safeCount(row.conflictedContextTotal),
      safeCount(row.contextTotal),
    ),
    revisionRate: ratio(safeCount(row.revisedOutcomeTotal), activeOutcomeTotal),
    retentionHealthy: retention.healthy,
    writeFailureCount: safeCount(row.writeFailureCount),
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    inputWatermark: row.inputWatermark ?? input.windowEnd,
    evaluatedAt: capturedAt,
  })
}

function safeCount(value: bigint | number): number {
  const count = Number(value)
  return Number.isSafeInteger(count) && count >= 0 ? count : 0
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

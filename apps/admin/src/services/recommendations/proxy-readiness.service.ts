import { createHash, randomUUID } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { prisma as defaultPrisma } from "@/db/client"
import { ACTIVE_WATCH_PROXY_VERSION } from "./contracts"
import { RecommendationInputError } from "./errors"

const MIN_SHADOW_SAMPLE = 100
const MAX_MISSING_RATE = 0.2
const MIN_PAIRED_RATE = 0.8
const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000
const READINESS_LOCK_ID = 369_000_001

type ReadinessCounts = Readonly<{
  sampleCount: number
  pairedCount: number
  missingCount: number
}>

export type PlaybackProxyReadinessDecision = Readonly<{
  decision:
    | "eligible_for_shadow_evaluation"
    | "revise"
    | "retire"
    | "inconclusive"
  reasonCodes: string[]
  rankingInfluence: false
}>

export function decidePlaybackProxyReadiness(
  metrics: ReadinessCounts,
): PlaybackProxyReadinessDecision {
  if (metrics.sampleCount < MIN_SHADOW_SAMPLE) {
    return {
      decision: "inconclusive",
      reasonCodes: ["insufficient_sample"],
      rankingInfluence: false,
    }
  }
  const pairedRate = metrics.pairedCount / metrics.sampleCount
  const missingRate = metrics.missingCount / metrics.sampleCount
  if (pairedRate < MIN_PAIRED_RATE) {
    return {
      decision: "revise",
      reasonCodes: ["paired_classifier_evidence_missing"],
      rankingInfluence: false,
    }
  }
  if (missingRate > MAX_MISSING_RATE) {
    return {
      decision: "revise",
      reasonCodes: ["active_coverage_missing"],
      rankingInfluence: false,
    }
  }
  return {
    decision: "eligible_for_shadow_evaluation",
    reasonCodes: ["paired_coverage_ready"],
    rankingInfluence: false,
  }
}

type AggregateRow = ReadinessCounts &
  Readonly<{
    agreementRate: number | null
    activeQualifiedRate: number | null
    legacyQualifiedRate: number | null
    lateRevisionRate: number | null
    finalizationLagP95Ms: number | null
    durationCohorts: Prisma.JsonValue
  }>

type Dependencies = Readonly<{
  prisma: PrismaClient
  now?: () => Date
  newId?: () => string
}>

export class PlaybackProxyReadinessService {
  constructor(private readonly deps: Dependencies) {}

  async evaluate(input: { windowStart: Date; windowEnd: Date }) {
    const now = this.deps.now?.() ?? new Date()
    if (
      !Number.isFinite(input.windowStart.getTime()) ||
      !Number.isFinite(input.windowEnd.getTime()) ||
      input.windowStart >= input.windowEnd ||
      input.windowEnd > now ||
      input.windowEnd.getTime() - input.windowStart.getTime() > MAX_WINDOW_MS
    ) {
      throw new RecommendationInputError(
        "Playback proxy evaluation window is invalid",
      )
    }
    return this.deps.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${READINESS_LOCK_ID})`
      const rows = await tx.$queryRaw<AggregateRow[]>(Prisma.sql`
        WITH ranked AS (
          SELECT
            outcome.*,
            row_number() OVER (
              PARTITION BY outcome.episode_id, outcome.classifier_version
              ORDER BY outcome.revision DESC
            ) AS classifier_rank
          FROM recommendation_outcome_revision outcome
          WHERE outcome.created_at >= ${input.windowStart}
            AND outcome.created_at < ${input.windowEnd}
            AND outcome.classifier_version IN (
              'legacy-position-v0', ${ACTIVE_WATCH_PROXY_VERSION}
            )
        ), paired AS (
          SELECT
            episode.id,
            episode.created_at,
            episode.finalized_at,
            active.qualified_view AS active_qualified,
            active.active_coverage,
            active.duration_cohort,
            active.revision AS active_revision,
            legacy.qualified_view AS legacy_qualified
          FROM recommendation_playback_episode episode
          LEFT JOIN ranked active
            ON active.episode_id = episode.id
           AND active.classifier_version = ${ACTIVE_WATCH_PROXY_VERSION}
           AND active.classifier_rank = 1
          LEFT JOIN ranked legacy
            ON legacy.episode_id = episode.id
           AND legacy.classifier_version = 'legacy-position-v0'
           AND legacy.classifier_rank = 1
          WHERE episode.finalized_at >= ${input.windowStart}
            AND episode.finalized_at < ${input.windowEnd}
        )
        SELECT
          count(*)::integer AS "sampleCount",
          count(*) FILTER (
            WHERE active_qualified IS NOT NULL AND legacy_qualified IS NOT NULL
          )::integer AS "pairedCount",
          count(*) FILTER (
            WHERE active_coverage IS NULL OR active_coverage = 'missing'
          )::integer AS "missingCount",
          (avg((active_qualified = legacy_qualified)::integer)
            FILTER (WHERE active_qualified IS NOT NULL AND legacy_qualified IS NOT NULL))::double precision
            AS "agreementRate",
          avg(active_qualified::integer)::double precision AS "activeQualifiedRate",
          avg(legacy_qualified::integer)::double precision AS "legacyQualifiedRate",
          avg((active_revision > 1)::integer)::double precision AS "lateRevisionRate",
          percentile_cont(0.95) WITHIN GROUP (
            ORDER BY extract(epoch FROM (finalized_at - created_at)) * 1000
          )::integer AS "finalizationLagP95Ms",
          jsonb_build_object(
            'short', count(*) FILTER (WHERE duration_cohort = 'short'),
            'medium', count(*) FILTER (WHERE duration_cohort = 'medium'),
            'long', count(*) FILTER (WHERE duration_cohort = 'long'),
            'unknown', count(*) FILTER (WHERE duration_cohort = 'unknown')
          ) AS "durationCohorts"
        FROM paired
      `)
      const metrics = rows[0] ?? {
        sampleCount: 0,
        pairedCount: 0,
        missingCount: 0,
        agreementRate: null,
        activeQualifiedRate: null,
        legacyQualifiedRate: null,
        lateRevisionRate: null,
        finalizationLagP95Ms: null,
        durationCohorts: {},
      }
      const readiness = decidePlaybackProxyReadiness(metrics)
      const latest = await tx.playbackProxyEvaluation.findFirst({
        where: { proxyVersion: ACTIVE_WATCH_PROXY_VERSION },
        orderBy: { revision: "desc" },
        select: { revision: true },
      })
      const revision = (latest?.revision ?? 0) + 1
      const inputDigest = createHash("sha256")
        .update(
          JSON.stringify({
            proxyVersion: ACTIVE_WATCH_PROXY_VERSION,
            windowStart: input.windowStart.toISOString(),
            windowEnd: input.windowEnd.toISOString(),
            metrics,
          }),
        )
        .digest("hex")
      return tx.playbackProxyEvaluation.create({
        data: {
          id: this.deps.newId?.() ?? randomUUID(),
          proxyVersion: ACTIVE_WATCH_PROXY_VERSION,
          revision,
          windowStart: input.windowStart,
          windowEnd: input.windowEnd,
          ...metrics,
          durationCohorts: metrics.durationCohorts as Prisma.InputJsonValue,
          ...readiness,
          inputDigest,
          createdAt: now,
        },
      })
    })
  }
}

export function createPlaybackProxyReadinessService(
  prisma: PrismaClient = defaultPrisma,
) {
  return new PlaybackProxyReadinessService({ prisma })
}

import { createHash, randomUUID } from "node:crypto"
import {
  type PrismaClient,
  type RecommendationPlaybackSignalReadiness,
} from "@prisma/client"
import { prisma as defaultPrisma } from "@/db/client"
import { loadPlaybackObservationWindow } from "./admin-ops/playback-observation-window"
import { RecommendationInputError } from "./errors"

export const PLAYBACK_SIGNAL_READINESS_VERSION = "playback-signal-readiness-v1"
const DAY_MS = 86_400_000
const LOCK_ID = 370_000_001

export type PlaybackSignalFamily = "navigation" | "qoe"
type FamilyCounts = Readonly<{
  episodes: number
  v2Summaries: number
  observed: number
  partial: number
  missing: number
}>

/** Evidence quality, not playback preference or authorization for live use. */
export function decidePlaybackSignalReadiness(input: FamilyCounts) {
  if (input.episodes < 100 || input.v2Summaries < 100) {
    return {
      ingestionHealth: "unknown" as const,
      decision: "inconclusive" as const,
      reasonCodes: ["insufficient_v2_sample"],
      reevaluationCondition:
        "Reevaluate after at least 100 v2 summaries in a mature window.",
      rankingInfluence: false as const,
    }
  }
  if (input.episodes >= 500 && input.observed === 0) {
    return {
      ingestionHealth: "degraded" as const,
      decision: "retire" as const,
      reasonCodes: ["no_reconciled_episodes"],
      reevaluationCondition:
        "Retire this collector version; redesign and evaluate a new version.",
      rankingInfluence: false as const,
    }
  }
  if (input.observed / input.episodes < 0.8) {
    return {
      ingestionHealth: "degraded" as const,
      decision: "revise" as const,
      reasonCodes: ["observation_coverage_below_80_percent"],
      reevaluationCondition:
        "Repair missing or partial evidence, then evaluate the next mature window.",
      rankingInfluence: false as const,
    }
  }
  return {
    ingestionHealth: "healthy" as const,
    decision: "eligible_for_shadow_evaluation" as const,
    reasonCodes: ["reconciled_coverage_ready"],
    reevaluationCondition:
      "Reevaluate in the next mature window before any new study.",
    rankingInfluence: false as const,
  }
}

export class PlaybackSignalReadinessService {
  constructor(
    private readonly deps: {
      prisma: PrismaClient
      now?: () => Date
      newId?: () => string
    },
  ) {}

  async evaluate(input: {
    windowStart: Date
    windowEnd: Date
  }): Promise<RecommendationPlaybackSignalReadiness[]> {
    const now = this.deps.now?.() ?? new Date()
    if (
      !Number.isFinite(input.windowStart.getTime()) ||
      !Number.isFinite(input.windowEnd.getTime()) ||
      input.windowStart >= input.windowEnd ||
      input.windowEnd > now ||
      input.windowEnd.getTime() - input.windowStart.getTime() > 29 * DAY_MS
    )
      throw new RecommendationInputError("Playback signal window is invalid")

    const results: RecommendationPlaybackSignalReadiness[] = []
    const failures: Error[] = []
    for (const family of ["navigation", "qoe"] as const) {
      try {
        const result = await this.deps.prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SET LOCAL statement_timeout = '4000ms'`
            await tx.$executeRaw`SET LOCAL jit = off`
            const lockId = LOCK_ID + (family === "qoe" ? 1 : 0)
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockId})`
            const window = await loadPlaybackObservationWindow(
              tx,
              { preset: "7d", start: input.windowStart, end: input.windowEnd },
              now,
            )
            const counts = window[family]
            const readiness = decidePlaybackSignalReadiness({
              episodes: window.episodes,
              v2Summaries: window.v2Summaries,
              observed: counts.v2Observed,
              partial: counts.partial + counts.legacyObserved,
              missing: counts.missing,
            })
            const inputDigest = createHash("sha256")
              .update(
                JSON.stringify({
                  policyVersion: PLAYBACK_SIGNAL_READINESS_VERSION,
                  family,
                  windowStart: input.windowStart.toISOString(),
                  windowEnd: input.windowEnd.toISOString(),
                  counts,
                  breakdowns: window.breakdowns.map((row) => ({
                    deviceClass: row.deviceClass,
                    networkClass: row.networkClass,
                    episodes: row.episodes,
                    observed:
                      family === "navigation"
                        ? row.navigationV2Observed
                        : row.qoeV2Observed,
                    partial:
                      family === "navigation"
                        ? row.navigationPartial
                        : row.qoePartial,
                  })),
                }),
              )
              .digest("hex")
            const existing =
              await tx.recommendationPlaybackSignalReadiness.findFirst({
                where: {
                  family,
                  windowStart: input.windowStart,
                  windowEnd: input.windowEnd,
                  inputDigest,
                },
              })
            if (existing) return existing
            const latest =
              await tx.recommendationPlaybackSignalReadiness.findFirst({
                where: { family },
                orderBy: { revision: "desc" },
                select: { revision: true },
              })
            return tx.recommendationPlaybackSignalReadiness.create({
              data: {
                id: this.deps.newId?.() ?? randomUUID(),
                family,
                policyVersion: PLAYBACK_SIGNAL_READINESS_VERSION,
                revision: (latest?.revision ?? 0) + 1,
                windowStart: input.windowStart,
                windowEnd: input.windowEnd,
                episodeCount: window.episodes,
                v2SummaryCount: window.v2Summaries,
                observedCount: counts.v2Observed,
                partialCount: counts.partial + counts.legacyObserved,
                missingCount: counts.missing,
                ...readiness,
                inputDigest,
                createdAt: now,
              },
            })
          },
          { maxWait: 1000, timeout: 5000 },
        )
        results.push(result)
      } catch (error) {
        failures.push(
          new Error(`${family} readiness evaluation failed`, { cause: error }),
        )
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, "Playback signal readiness incomplete")
    return results
  }
}

export function createPlaybackSignalReadinessService(
  prisma: PrismaClient = defaultPrisma,
) {
  return new PlaybackSignalReadinessService({ prisma })
}

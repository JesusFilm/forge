import { Prisma, type PrismaClient } from "@prisma/client"
import { HYBRID_CANDIDATE_GENERATOR_SET_VERSION } from "@/services/recommendations/candidate"
import {
  HYBRID_PERSONALIZED_MANIFEST_ID,
  isExactHybridPersonalizedManifest,
  isEquivalentSemanticChallenger,
  recommendationManifestDigest,
} from "@/services/recommendations/promotion/manifest"
import { promotionReadiness } from "@/services/recommendations/promotion/policy"
import type {
  RecommendationExperimentEvaluationData,
  RecommendationProfileShadowOverviewData,
  RecommendationPromotionOverviewData,
} from "./overview.service"
import type { RecommendationOpsWindow } from "./shared"

export async function loadProfileShadowOverview(
  prisma: PrismaClient,
  window: RecommendationOpsWindow,
  now: Date,
): Promise<RecommendationProfileShadowOverviewData | null> {
  type Row = {
    manifestEnabled: boolean
    generationCount: bigint | number
    durableGenerationCount: bigint | number
    sessionGenerationCount: bigint | number
    failedRunCount: bigint | number
    coverage: number | null
    stability: number | null
    inputWatermark: Date | null
    expiryWatermark: Date | null
    interests: unknown
  }
  const manifestId = "multi-interest-profile-shadow-v1"
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    WITH scoped_generation AS (
      SELECT generation.*
      FROM recommendation_profile_projection_generation generation
      WHERE generation.manifest_id = ${manifestId}
        AND generation.created_at >= ${window.start}
        AND generation.created_at < ${window.end}
        AND generation.expires_at > ${now}
    ), interest_summary AS (
      SELECT COALESCE(jsonb_agg(summary ORDER BY summary.kind, summary.ordinal), '[]'::jsonb) AS interests
      FROM (
        SELECT
          interest.kind::text AS kind,
          interest.interest_ordinal AS ordinal,
          COUNT(DISTINCT interest.generation_id) AS generations,
          AVG(interest.stability) AS stability
        FROM recommendation_profile_interest interest
        JOIN scoped_generation generation ON generation.id = interest.generation_id
        WHERE interest.expires_at > ${now}
        GROUP BY interest.kind, interest.interest_ordinal
      ) summary
    )
    SELECT
      manifest.enabled AS "manifestEnabled",
      COUNT(DISTINCT generation.id) AS "generationCount",
      COUNT(DISTINCT generation.id) FILTER (WHERE generation.scope = 'durable') AS "durableGenerationCount",
      COUNT(DISTINCT generation.id) FILTER (WHERE generation.scope = 'session') AS "sessionGenerationCount",
      (
        SELECT COUNT(*) FROM recommendation_profile_projection_run run
        WHERE run.created_at >= ${window.start}
          AND run.created_at < ${window.end}
          AND run.state = 'failed'
      ) AS "failedRunCount",
      AVG(generation.coverage) FILTER (WHERE generation.state = 'published') AS coverage,
      AVG(generation.stability) FILTER (WHERE generation.state = 'published') AS stability,
      MAX(generation.input_watermark) AS "inputWatermark",
      MIN(generation.expires_at) AS "expiryWatermark",
      (SELECT interests FROM interest_summary) AS interests
    FROM recommendation_strategy_manifest manifest
    LEFT JOIN scoped_generation generation ON true
    WHERE manifest.id = ${manifestId}
    GROUP BY manifest.enabled
  `)
  const row = rows?.[0]
  if (!row) return null
  const generationCount = count(row.generationCount)
  // U12's small-cohort rule applies to operational summaries too. Counts and
  // watermarks remain visible; per-interest quality waits for three builds.
  const metricsSuppressed = generationCount < 3
  const evaluation = await prisma.recommendationShadowEvaluation.findFirst({
    where: { manifestId, expiresAt: { gt: now } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { decision: true },
  })
  return {
    manifestId,
    manifestEnabled: row.manifestEnabled,
    shadowOnly: true,
    generationCount,
    durableGenerationCount: count(row.durableGenerationCount),
    sessionGenerationCount: count(row.sessionGenerationCount),
    failedRunCount: count(row.failedRunCount),
    metricsSuppressed,
    coverage: metricsSuppressed ? null : finiteNumber(row.coverage),
    stability: metricsSuppressed ? null : finiteNumber(row.stability),
    inputWatermark: row.inputWatermark,
    expiryWatermark: row.expiryWatermark,
    interests: metricsSuppressed ? [] : profileInterestSummary(row.interests),
    evaluation: evaluation
      ? {
          state: evaluation.state === "TERMINAL" ? "terminal" : "active",
          sampledCount: evaluation.sampledCount,
          processedCount: evaluation.processedCount,
          failedCount: evaluation.failedCount,
          coverage: evaluation.coverage,
          overlap: evaluation.overlap,
          novelty: evaluation.novelty,
          diversity: evaluation.diversity,
          cohortQuality: evaluation.cohortQuality,
          latencyP95Ms: evaluation.latencyP95Ms,
          inputWatermark: evaluation.inputWatermark,
          decision: evaluation.decision?.decision ?? null,
          reasonCode: evaluation.decision?.reasonCode ?? null,
          reevaluationCondition:
            evaluation.decision?.reevaluationCondition ?? null,
        }
      : null,
  }
}

function profileInterestSummary(
  value: unknown,
): RecommendationProfileShadowOverviewData["interests"] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const row = entry as Record<string, unknown>
    if (
      (row.kind !== "durable" && row.kind !== "session") ||
      !Number.isInteger(Number(row.ordinal))
    ) {
      return []
    }
    return [
      {
        kind: row.kind as "durable" | "session",
        ordinal: Number(row.ordinal),
        generations: count(row.generations as number),
        stability: finiteNumber(row.stability as number | null),
      },
    ]
  })
}

export async function loadPromotionState(prisma: PrismaClient, now: Date) {
  // Keeps older test and N-1 clients compatible while migration 0061 is in its
  // expand window. Absence means "promotion unavailable", never activation.
  if (!prisma.recommendationPromotionPointer) return null
  const [
    pointer,
    latestApproval,
    latestRun,
    audit,
    conflictCount,
    hybridShadowDecision,
  ] = await Promise.all([
    prisma.recommendationPromotionPointer.findUnique({
      where: { id: "recommendation-promotion-pointer" },
      include: {
        activeManifest: true,
        lastKnownGoodManifest: { select: { id: true, enabled: true } },
      },
    }),
    prisma.recommendationPromotionApproval.findFirst({
      where: { expiresAt: { gt: now } },
      include: { manifest: true },
      orderBy: [{ approvedAt: "desc" }, { id: "desc" }],
    }),
    prisma.recommendationPromotionRun.findFirst({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    prisma.recommendationPromotionEvent.findMany({
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: 8,
      select: {
        id: true,
        eventType: true,
        fromManifestId: true,
        toManifestId: true,
        pointerGeneration: true,
        reasonCode: true,
        actorClass: true,
        occurredAt: true,
      },
    }),
    prisma.recommendationPromotionRun.count({
      where: { state: "FENCED" },
    }),
    prisma.recommendationShadowDecision?.findFirst?.({
      where: {
        decision: "PROMOTE_TO_EXPERIMENT",
        expiresAt: { gt: now },
        evaluation: {
          manifestId: HYBRID_PERSONALIZED_MANIFEST_ID,
          generatorVersion: HYBRID_CANDIDATE_GENERATOR_SET_VERSION,
        },
      },
      orderBy: [{ decidedAt: "desc" }, { id: "desc" }],
      select: {
        decision: true,
        evaluation: { select: { manifestId: true } },
      },
    }) ?? Promise.resolve(null),
  ])
  return pointer
    ? {
        pointer,
        latestApproval,
        latestRun,
        audit,
        conflictCount,
        hybridShadowDecision,
      }
    : null
}

export function recommendationPromotionOverview(input: {
  state: NonNullable<Awaited<ReturnType<typeof loadPromotionState>>>
  evaluation: {
    id: string
    state: string
    guardrails: unknown
    experiment: {
      challengerManifestId: string
      challengerProbability: number
    }
  } | null
  now: Date
}): RecommendationPromotionOverviewData {
  const { pointer, latestApproval, latestRun, audit, conflictCount } =
    input.state
  const evaluation = input.evaluation
  const authorizedApproval =
    latestApproval &&
    (isEquivalentSemanticChallenger(latestApproval.manifest) ||
      isExactHybridPersonalizedManifest(latestApproval.manifest))
      ? latestApproval
      : null
  const initialShadowAuthorization = Boolean(
    pointer.stage === "CONTROL" &&
    authorizedApproval &&
    isExactHybridPersonalizedManifest(authorizedApproval.manifest) &&
    input.state.hybridShadowDecision?.decision === "PROMOTE_TO_EXPERIMENT",
  )
  const approvalMatches = Boolean(
    authorizedApproval &&
    authorizedApproval.manifestDigest ===
      recommendationManifestDigest(authorizedApproval.manifest) &&
    authorizedApproval.expiresAt > input.now &&
    ((evaluation &&
      authorizedApproval.manifestId ===
        evaluation.experiment.challengerManifestId) ||
      initialShadowAuthorization),
  )
  const guardrailsPassed = Boolean(
    evaluation &&
    typeof evaluation.guardrails === "object" &&
    evaluation.guardrails !== null &&
    !Array.isArray(evaluation.guardrails) &&
    "passed" in evaluation.guardrails &&
    evaluation.guardrails.passed === true,
  )
  const targetAvailable = Boolean(authorizedApproval?.manifest.enabled)
  const readiness = promotionReadiness({
    stage: promotionStage(pointer.stage),
    evaluationState: evaluation
      ? promotionEvaluationState(evaluation.state)
      : null,
    guardrailsPassed,
    initialShadowAuthorization,
    approvalMatches,
    targetAvailable,
    killSwitchEnabled: pointer.killSwitchEnabled,
    exposureCeilingBps:
      pointer.stage === "CONTROL"
        ? (authorizedApproval?.maxExposureBps ?? 0)
        : pointer.exposureCeilingBps,
    lastKnownGoodManifestId: pointer.lastKnownGoodManifestId,
  })
  return {
    generation: pointer.generation,
    stage: promotionStage(pointer.stage),
    activeManifestId: pointer.activeManifestId,
    targetManifestId:
      authorizedApproval?.manifestId ??
      input.state.hybridShadowDecision?.evaluation.manifestId ??
      null,
    lastKnownGoodManifestId: pointer.lastKnownGoodManifestId,
    fallbackAvailable: pointer.lastKnownGoodManifest.enabled,
    exposureCeilingBps: pointer.exposureCeilingBps,
    proposedExposureCeilingBps:
      authorizedApproval?.maxExposureBps ??
      (evaluation
        ? Math.round(evaluation.experiment.challengerProbability * 10_000)
        : input.state.hybridShadowDecision
          ? 100
          : 0),
    killSwitchEnabled: pointer.killSwitchEnabled,
    reasonCode: pointer.reasonCode,
    readiness,
    approval: authorizedApproval
      ? {
          id: authorizedApproval.id,
          manifestDigest: authorizedApproval.manifestDigest,
          maxExposureBps: authorizedApproval.maxExposureBps,
          approvedAt: authorizedApproval.approvedAt,
          expiresAt: authorizedApproval.expiresAt,
        }
      : null,
    evaluationId: evaluation?.id ?? null,
    evaluationState: evaluation
      ? experimentEvaluationState(evaluation.state)
      : null,
    workflow: latestRun
      ? {
          id: latestRun.id,
          action: latestRun.action.toLowerCase(),
          state: promotionWorkflowState(latestRun.state),
          failureReason: latestRun.failureReason,
          createdAt: latestRun.createdAt,
          completedAt: latestRun.completedAt,
        }
      : null,
    conflictCount,
    audit: audit.map((event) => ({
      ...event,
      eventType: event.eventType.toLowerCase(),
    })),
  }
}

function promotionEvaluationState(
  state: string,
): "pass" | "fail" | "inconclusive" | "data_unhealthy" {
  return state === "PASS"
    ? "pass"
    : state === "FAIL"
      ? "fail"
      : state === "DATA_UNHEALTHY"
        ? "data_unhealthy"
        : "inconclusive"
}

function promotionStage(
  stage: string,
): RecommendationPromotionOverviewData["stage"] {
  return stage === "BOUNDED"
    ? "bounded"
    : stage === "PERMANENT"
      ? "permanent"
      : "control"
}

function promotionWorkflowState(
  state: string,
): NonNullable<RecommendationPromotionOverviewData["workflow"]>["state"] {
  return state === "PENDING"
    ? "pending"
    : state === "CLAIMED"
      ? "active"
      : state === "COMPLETED"
        ? "complete"
        : state === "FENCED"
          ? "stale"
          : "failed"
}

function experimentEvaluationState(
  state: string,
): RecommendationExperimentEvaluationData["state"] {
  return state === "DATA_UNHEALTHY"
    ? "data-unhealthy"
    : (state.toLowerCase() as RecommendationExperimentEvaluationData["state"])
}

function count(value: bigint | number): number {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : 0
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return value
}

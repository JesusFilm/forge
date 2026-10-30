import type { PrismaClient } from "@prisma/client"
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
  _prisma: PrismaClient,
  _window: RecommendationOpsWindow,
  _now: Date,
): Promise<RecommendationProfileShadowOverviewData | null> {
  return null
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
        activeOwnerRelease: true,
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
    evaluationPolicyVersion?: string
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
  const studyEvaluation =
    evaluation?.evaluationPolicyVersion === "profile-study-governance-v1"
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
  if (
    pointer.stage !== "OWNER_APPROVED" &&
    (studyEvaluation ||
      pointer.reasonCode === "profile_calibration_active" ||
      pointer.reasonCode === "profile_efficacy_active" ||
      authorizedApproval?.manifestId === HYBRID_PERSONALIZED_MANIFEST_ID)
  ) {
    readiness.ready = false
    readiness.reason =
      "Profile study results require their exact version-bound authority; a database PASS alone is insufficient."
    readiness.nextAction =
      "Open Governed profile studies to inspect calibration, comparator and current evidence."
  }
  return {
    generation: pointer.generation,
    stage: promotionStage(pointer.stage),
    ownerRelease: pointer.activeOwnerRelease
      ? {
          id: pointer.activeOwnerRelease.id,
          graphGenerationId: pointer.activeOwnerRelease.graphGenerationId,
          validUntil: pointer.activeOwnerRelease.validUntil,
          revoked:
            pointer.activeOwnerRelease.revokedAt != null ||
            pointer.activeOwnerRelease.pointerGeneration <
              pointer.ownerInfluenceFloorGeneration,
        }
      : null,
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
  return stage === "OWNER_APPROVED"
    ? "owner_approved"
    : stage === "BOUNDED"
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

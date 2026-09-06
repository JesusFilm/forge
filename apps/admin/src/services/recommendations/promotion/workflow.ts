import {
  Prisma,
  RecommendationExperimentAssignmentState,
  RecommendationExperimentEvaluationRunState,
  RecommendationExperimentState,
  RecommendationPromotionEventType,
  RecommendationPromotionRunState,
  RecommendationPromotionStage,
} from "@prisma/client"
import { digestValue } from "./manifest"

const DAY_MS = 86_400_000
const APPROVAL_RETENTION_DAYS = 2_555
const HYBRID_PERSONALIZED_EXPERIMENT_DAYS = 365

export async function fencePromotionRun(
  tx: Prisma.TransactionClient,
  runId: string,
  input: { expectedGeneration: number; claimId: string },
  now: Date,
  reason: string,
) {
  await tx.recommendationPromotionRun.updateMany({
    where: {
      id: runId,
      generation: input.expectedGeneration,
      claimId: input.claimId,
      state: RecommendationPromotionRunState.CLAIMED,
    },
    data: {
      state: RecommendationPromotionRunState.FENCED,
      failureReason: reason,
      completedAt: now,
    },
  })
}

export async function applyPromotionRollbackPolicy(
  tx: Prisma.TransactionClient,
  input: {
    runId: string
    experimentId: string | null
    experimentGeneration: number | null
    activeManifestId: string
    pointerGeneration: number
    now: Date
  },
) {
  const fallbackExperiments = input.experimentId
    ? []
    : await tx.recommendationExperiment.findMany({
        where: {
          challengerManifestId: input.activeManifestId,
          state: RecommendationExperimentState.ACTIVE,
        },
        select: { id: true, generation: true },
      })
  const experimentIds = input.experimentId
    ? [input.experimentId]
    : fallbackExperiments.map((experiment) => experiment.id)
  const assignments = await tx.recommendationExperimentAssignment.updateMany({
    where: {
      state: RecommendationExperimentAssignmentState.ACTIVE,
      experimentId: { in: experimentIds },
    },
    data: {
      state: RecommendationExperimentAssignmentState.FENCED,
      fencedAt: input.now,
      fenceReason: "promotion_rollback",
    },
  })
  const evaluationRuns =
    await tx.recommendationExperimentEvaluationRun.updateMany({
      where: {
        experimentId: { in: experimentIds },
        state: {
          in: [
            RecommendationExperimentEvaluationRunState.PENDING,
            RecommendationExperimentEvaluationRunState.CLAIMED,
          ],
        },
      },
      data: {
        state: RecommendationExperimentEvaluationRunState.FENCED,
        failureReason: "promotion_rollback",
        completedAt: input.now,
      },
    })
  if (input.experimentId && input.experimentGeneration != null) {
    await tx.recommendationExperiment.updateMany({
      where: {
        id: input.experimentId,
        generation: input.experimentGeneration,
      },
      data: { generation: { increment: 1 } },
    })
  } else if (fallbackExperiments.length > 0) {
    await Promise.all(
      fallbackExperiments.map((experiment) =>
        tx.recommendationExperiment.updateMany({
          where: { id: experiment.id, generation: experiment.generation },
          data: { generation: { increment: 1 } },
        }),
      ),
    )
  }
  const pendingPromotionRuns = await tx.recommendationPromotionRun.updateMany({
    where: {
      id: { not: input.runId },
      expectedPointerGeneration: { lt: input.pointerGeneration },
      state: {
        in: [
          RecommendationPromotionRunState.PENDING,
          RecommendationPromotionRunState.CLAIMED,
        ],
      },
    },
    data: {
      state: RecommendationPromotionRunState.FENCED,
      failureReason: "promotion_rollback",
      completedAt: input.now,
    },
  })
  const storedSlates = await tx.$executeRaw(Prisma.sql`
    INSERT INTO recommendation_promotion_slate_fence (
      id, request_id, pointer_generation, reason_code, fenced_at, expires_at
    )
    SELECT gen_random_uuid()::text, request.id, ${input.pointerGeneration},
      'promotion_rollback', ${input.now}, request.expires_at
    FROM recommendation_request request
    JOIN recommendation_experiment_assignment assignment
      ON assignment.id = request.experiment_assignment_id
    WHERE request.expires_at > ${input.now}
      AND assignment.experiment_id = ANY(${experimentIds}::text[])
      AND NOT EXISTS (
        SELECT 1 FROM recommendation_promotion_slate_fence fence
        WHERE fence.request_id = request.id
      )
    ON CONFLICT (request_id) DO NOTHING
  `)
  return {
    assignmentsFenced: assignments.count,
    evaluationRunsFenced: evaluationRuns.count,
    promotionRunsFenced: pendingPromotionRuns.count,
    storedSlatesFenced: Number(storedSlates),
    cachePolicy: "all_candidate_pools_cleared_after_commit",
  }
}

export async function openInitialHybridPersonalizedExperiment(
  tx: Prisma.TransactionClient,
  input: {
    runId: string
    surfaceVersion: string
    controlManifestId: string
    challengerManifestId: string
    challengerProbability: number
    approvalId: string
    shadowDecisionId: string
    now: Date
  },
) {
  const existing = await tx.recommendationExperiment.findMany({
    where: {
      surfaceVersion: input.surfaceVersion,
      state: RecommendationExperimentState.ACTIVE,
    },
    select: { id: true },
  })
  const existingIds = existing.map((experiment) => experiment.id)
  const [assignments, evaluationRuns, experiments] = await Promise.all([
    tx.recommendationExperimentAssignment.updateMany({
      where: {
        experimentId: { in: existingIds },
        state: RecommendationExperimentAssignmentState.ACTIVE,
      },
      data: {
        state: RecommendationExperimentAssignmentState.FENCED,
        fencedAt: input.now,
        fenceReason: "experiment_superseded",
      },
    }),
    tx.recommendationExperimentEvaluationRun.updateMany({
      where: {
        experimentId: { in: existingIds },
        state: {
          in: [
            RecommendationExperimentEvaluationRunState.PENDING,
            RecommendationExperimentEvaluationRunState.CLAIMED,
          ],
        },
      },
      data: {
        state: RecommendationExperimentEvaluationRunState.FENCED,
        failureReason: "experiment_superseded",
        completedAt: input.now,
      },
    }),
    tx.recommendationExperiment.updateMany({
      where: {
        id: { in: existingIds },
        state: RecommendationExperimentState.ACTIVE,
      },
      data: {
        state: RecommendationExperimentState.CLOSED,
        generation: { increment: 1 },
      },
    }),
  ])
  const runDigest = digestValue(input.runId)
  const experimentId = `anonymous-hybrid-personalized-${runDigest.slice(0, 32)}`
  const experimentVersion = `hybrid-personalized-${runDigest.slice(0, 32)}`
  const endsAt = new Date(
    input.now.getTime() + HYBRID_PERSONALIZED_EXPERIMENT_DAYS * DAY_MS,
  )
  const created = await tx.recommendationExperiment.create({
    data: {
      id: experimentId,
      experimentVersion,
      surfaceVersion: input.surfaceVersion,
      controlManifestId: input.controlManifestId,
      challengerManifestId: input.challengerManifestId,
      assignmentPolicyVersion: "sticky-deterministic-assignment-v1",
      outcomePolicyVersion: "active-watch-multi-outcome-v1",
      integrityPolicyVersion: "recommendation-integrity-v1",
      evaluationPolicyVersion: "recommendation-hybrid-personalized-v1",
      configurationDigest: digestValue({
        experimentVersion,
        surfaceVersion: input.surfaceVersion,
        controlManifestId: input.controlManifestId,
        challengerManifestId: input.challengerManifestId,
        challengerProbability: input.challengerProbability,
        approvalId: input.approvalId,
        shadowDecisionId: input.shadowDecisionId,
      }),
      challengerProbability: input.challengerProbability,
      startsAt: input.now,
      endsAt,
      purpose: "anonymous_hybrid_personalization",
      identityClass: "pseudonymous_assignment_digest",
      accessClass: "recommendation_experiment_readers",
      deletionBehavior: "fence_assignment_and_rebuild_evaluation",
      fallbackBehavior: "semantic_control",
      retentionDays: HYBRID_PERSONALIZED_EXPERIMENT_DAYS,
      expiresAt: new Date(
        endsAt.getTime() + HYBRID_PERSONALIZED_EXPERIMENT_DAYS * DAY_MS,
      ),
    },
  })
  return {
    experimentId: created.id,
    challengerProbability: created.challengerProbability,
    supersededExperiments: experiments.count,
    supersededAssignments: assignments.count,
    supersededEvaluationRuns: evaluationRuns.count,
  }
}

export async function supersedeBoundedExperiment(
  tx: Prisma.TransactionClient,
  input: {
    currentRunId: string
    experimentId: string
    experimentGeneration: number
    pointerGeneration: number
    now: Date
  },
) {
  const assignments = await tx.recommendationExperimentAssignment.updateMany({
    where: {
      experimentId: input.experimentId,
      state: RecommendationExperimentAssignmentState.ACTIVE,
    },
    data: {
      state: RecommendationExperimentAssignmentState.FENCED,
      fencedAt: input.now,
      fenceReason: "permanent_default",
    },
  })
  const evaluationRuns =
    await tx.recommendationExperimentEvaluationRun.updateMany({
      where: {
        experimentId: input.experimentId,
        state: {
          in: [
            RecommendationExperimentEvaluationRunState.PENDING,
            RecommendationExperimentEvaluationRunState.CLAIMED,
          ],
        },
      },
      data: {
        state: RecommendationExperimentEvaluationRunState.FENCED,
        failureReason: "permanent_default",
        completedAt: input.now,
      },
    })
  const experiment = await tx.recommendationExperiment.updateMany({
    where: {
      id: input.experimentId,
      generation: input.experimentGeneration,
    },
    data: { generation: { increment: 1 } },
  })
  const promotionRuns = await tx.recommendationPromotionRun.updateMany({
    where: {
      id: { not: input.currentRunId },
      expectedPointerGeneration: { lt: input.pointerGeneration },
      state: {
        in: [
          RecommendationPromotionRunState.PENDING,
          RecommendationPromotionRunState.CLAIMED,
        ],
      },
    },
    data: {
      state: RecommendationPromotionRunState.FENCED,
      failureReason: "permanent_default",
      completedAt: input.now,
    },
  })
  return {
    assignmentsFenced: assignments.count,
    evaluationRunsFenced: evaluationRuns.count,
    experimentGenerationsAdvanced: experiment.count,
    promotionRunsFenced: promotionRuns.count,
  }
}

export function promotionEventData(input: {
  id: string
  dedupeKey: string
  eventType: RecommendationPromotionEventType
  runId?: string | null
  approvalId?: string | null
  evaluationId?: string | null
  fromManifestId?: string | null
  toManifestId: string
  fromStage?: RecommendationPromotionStage | null
  toStage: RecommendationPromotionStage
  pointerGeneration: number
  exposureCeilingBps: number
  actorClass: string
  actorId?: string | null
  reasonCode: string
  inputDigest: string
  details: Prisma.InputJsonValue
  now: Date
}) {
  const { now, ...event } = input
  return {
    ...event,
    runId: input.runId ?? null,
    approvalId: input.approvalId ?? null,
    evaluationId: input.evaluationId ?? null,
    fromManifestId: input.fromManifestId ?? null,
    fromStage: input.fromStage ?? null,
    actorId: input.actorId ?? null,
    expiresAt: new Date(now.getTime() + APPROVAL_RETENTION_DAYS * DAY_MS),
  }
}

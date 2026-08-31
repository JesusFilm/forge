import {
  RecommendationPromotionRunState,
  WorkflowRunStatus,
} from "@prisma/client"
import { start } from "workflow/api"
import { SYSTEM_PRINCIPAL } from "@/auth/principal"
import { prisma } from "@/db/client"
import {
  attachWorkflowRuntimeRunId,
  createWorkflowRunLog,
  markWorkflowRunFailed,
  markWorkflowRunRuntimeStarted,
  markWorkflowRunStarted,
} from "@/services/workflow-run-log.service"
import { runRecommendationPromotion } from "@/workflows/recommendationPromotion"
import {
  createRecommendationPromotionService,
  type CreatePromotionRunInput,
} from "./service"

export const RECOMMENDATION_PROMOTION_WORKFLOW_KEY = "recommendation-promotion"

export type RecommendationPromotionJobInput = Readonly<{
  runId: string
  expectedGeneration: number
  ledgerRunId?: string
}>

export async function dispatchRecommendationPromotion(
  input: CreatePromotionRunInput,
) {
  const run =
    await createRecommendationPromotionService(prisma).createRun(input)
  const ledger = await createWorkflowRunLog({
    workflowKey: RECOMMENDATION_PROMOTION_WORKFLOW_KEY,
    workflowName: "Recommendation Promotion",
    trigger: input.actor.role === "SYSTEM" ? "system" : "manual",
    subjectType: "recommendation-promotion-run",
    subjectId: run.id,
    summary: "Recommendation promotion transition queued.",
    details: {
      runId: run.id,
      action: input.action,
      expectedPointerGeneration: input.expectedPointerGeneration,
      targetManifestId: input.targetManifestId,
      exposureCeilingBps: input.exposureCeilingBps,
    },
  })
  let runtime: Awaited<ReturnType<typeof start>>
  try {
    runtime = await start(runRecommendationPromotion, [
      {
        runId: run.id,
        expectedGeneration: run.generation,
        ledgerRunId: ledger.id,
      },
    ])
  } catch (error) {
    await Promise.all([
      markWorkflowRunFailed(ledger.id, error).catch(() => {}),
      prisma.recommendationPromotionRun.updateMany({
        where: {
          id: run.id,
          generation: run.generation,
          state: RecommendationPromotionRunState.PENDING,
        },
        data: {
          state: RecommendationPromotionRunState.FAILED,
          failureReason: "workflow_dispatch_failed",
          completedAt: new Date(),
        },
      }),
    ])
    throw error
  }
  const recorded = await Promise.allSettled([
    attachWorkflowRuntimeRunId(ledger.id, runtime.runId),
    prisma.recommendationPromotionRun.updateMany({
      where: {
        id: run.id,
        generation: run.generation,
        OR: [
          { workflowRunId: null },
          { workflowRunId: { not: runtime.runId } },
        ],
      },
      data: { workflowRunId: runtime.runId },
    }),
  ])
  if (recorded.some(({ status }) => status === "rejected")) {
    console.warn(
      "Recommendation promotion started before all runtime identities could be recorded; workflow self-reconciliation will retry.",
    )
  }
  return {
    queued: true as const,
    runId: run.id,
    generation: run.generation,
    ledgerRunId: ledger.id,
    workflowRunId: runtime.runId,
  }
}

export async function markRecommendationPromotionRuntimeStarted(
  input: RecommendationPromotionJobInput,
  runtimeRunId: string,
): Promise<void> {
  await Promise.all([
    input.ledgerRunId
      ? markWorkflowRunRuntimeStarted(input.ledgerRunId, runtimeRunId)
      : Promise.resolve(),
    prisma.recommendationPromotionRun.updateMany({
      where: {
        id: input.runId,
        generation: input.expectedGeneration,
        state: RecommendationPromotionRunState.PENDING,
        OR: [{ workflowRunId: null }, { workflowRunId: { not: runtimeRunId } }],
      },
      data: { workflowRunId: runtimeRunId },
    }),
  ])
}

export async function dispatchAutomaticRecommendationRollback(input: {
  evaluationId: string
}) {
  const [evaluation, pointer] = await Promise.all([
    prisma.recommendationExperimentEvaluation.findUnique({
      where: { id: input.evaluationId },
      include: { experiment: true },
    }),
    prisma.recommendationPromotionPointer.findUnique({
      where: { id: "recommendation-promotion-pointer" },
    }),
  ])
  if (
    !evaluation ||
    evaluation.state !== "FAIL" ||
    !pointer ||
    pointer.stage === "CONTROL" ||
    pointer.activeManifestId !== evaluation.experiment.challengerManifestId
  ) {
    return { queued: false as const, reason: "rollback_not_required" }
  }
  return dispatchRecommendationPromotion({
    actor: SYSTEM_PRINCIPAL,
    action: "automatic_rollback",
    expectedPointerGeneration: pointer.generation,
    targetManifestId: pointer.lastKnownGoodManifestId,
    approvalId: pointer.activeApprovalId,
    evaluationId: evaluation.id,
    exposureCeilingBps: 0,
    recentAuthentication: false,
  })
}

export async function runRecommendationPromotionJob(
  input: RecommendationPromotionJobInput,
) {
  if (input.ledgerRunId) await markWorkflowRunStarted(input.ledgerRunId)
  const service = createRecommendationPromotionService(prisma)
  const claim = await service.claimRun({
    runId: input.runId,
    expectedGeneration: input.expectedGeneration,
  })
  if (claim.status === "fenced") {
    await finishLedger(input.ledgerRunId, WorkflowRunStatus.SKIPPED, {
      status: "fenced",
      reason: "claim_unavailable",
    })
    return { status: "fenced" as const, reason: "claim_unavailable" as const }
  }
  try {
    const result = await service.executeClaimedRun({
      runId: input.runId,
      expectedGeneration: input.expectedGeneration,
      claimId: claim.claimId,
    })
    await finishLedger(
      input.ledgerRunId,
      result.status === "fenced"
        ? WorkflowRunStatus.SKIPPED
        : WorkflowRunStatus.SUCCEEDED,
      result,
    )
    return result
  } catch (error) {
    await service
      .failClaimedRun({
        runId: input.runId,
        expectedGeneration: input.expectedGeneration,
        claimId: claim.claimId,
        reason: "promotion_transition_failed",
      })
      .catch(() => false)
    if (input.ledgerRunId) {
      await markWorkflowRunFailed(input.ledgerRunId, error).catch(() => {})
    }
    throw error
  }
}

async function finishLedger(
  ledgerRunId: string | undefined,
  status: WorkflowRunStatus,
  result: object,
) {
  if (!ledgerRunId) return
  await prisma.workflowRun.update({
    where: { id: ledgerRunId },
    data: {
      status,
      summary:
        status === WorkflowRunStatus.SUCCEEDED
          ? "Recommendation promotion transition completed."
          : "Recommendation promotion transition fenced.",
      details: result,
      finishedAt: new Date(),
    },
  })
}

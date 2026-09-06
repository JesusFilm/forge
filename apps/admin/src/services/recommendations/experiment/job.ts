import {
  RecommendationExperimentEvaluationRunState,
  WorkflowRunStatus,
} from "@prisma/client"
import { start } from "workflow/api"
import { prisma } from "@/db/client"
import {
  attachWorkflowRuntimeRunId,
  createWorkflowRunLog,
  markWorkflowRunFailed,
  markWorkflowRunRuntimeStarted,
  markWorkflowRunStarted,
} from "@/services/workflow-run-log.service"
import { runRecommendationExperimentEvaluation } from "@/workflows/recommendationExperimentEvaluation"
import { createRecommendationExperimentEvaluationService } from "./evaluation"
import { dispatchAutomaticRecommendationRollback } from "../promotion/job"

export const RECOMMENDATION_EXPERIMENT_EVALUATION_WORKFLOW_KEY =
  "recommendation-experiment-evaluation"

export type RecommendationExperimentEvaluationJobInput = Readonly<{
  runId: string
  expectedGeneration: number
  expectedExperimentGeneration: number
  ledgerRunId?: string
}>

export async function dispatchRecommendationExperimentEvaluation(input: {
  experimentId: string
  expectedExperimentGeneration: number
  windowStart: Date
  windowEnd: Date
}) {
  // Business-ledger truth exists before workflow dispatch. A runtime outage can
  // therefore be reconciled without inventing an evaluation result.
  const run =
    await createRecommendationExperimentEvaluationService(prisma).createRun(
      input,
    )
  const ledger = await createWorkflowRunLog({
    workflowKey: RECOMMENDATION_EXPERIMENT_EVALUATION_WORKFLOW_KEY,
    workflowName: "Recommendation Experiment Evaluation",
    trigger: "system",
    subjectType: "recommendation-experiment-evaluation-run",
    subjectId: run.runId,
    summary: "Recommendation experiment evaluation queued.",
    details: {
      experimentId: input.experimentId,
      runId: run.runId,
      expectedGeneration: run.generation,
      expectedExperimentGeneration: input.expectedExperimentGeneration,
      windowStart: input.windowStart.toISOString(),
      windowEnd: input.windowEnd.toISOString(),
      evaluationPlane: "offline",
    },
  })
  let runtime: Awaited<ReturnType<typeof start>>
  try {
    runtime = await start(runRecommendationExperimentEvaluation, [
      {
        runId: run.runId,
        expectedGeneration: run.generation,
        expectedExperimentGeneration: input.expectedExperimentGeneration,
        ledgerRunId: ledger.id,
      },
    ])
  } catch (error) {
    await Promise.all([
      markWorkflowRunFailed(ledger.id, error).catch(() => {}),
      prisma.recommendationExperimentEvaluationRun.updateMany({
        where: {
          id: run.runId,
          generation: run.generation,
          state: RecommendationExperimentEvaluationRunState.PENDING,
        },
        data: {
          state: RecommendationExperimentEvaluationRunState.FAILED,
          failureReason: "workflow_dispatch_failed",
          completedAt: new Date(),
        },
      }),
    ])
    throw error
  }
  const recorded = await Promise.allSettled([
    attachWorkflowRuntimeRunId(ledger.id, runtime.runId),
    prisma.recommendationExperimentEvaluationRun.updateMany({
      where: {
        id: run.runId,
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
      "Recommendation experiment evaluation started before all runtime identities could be recorded; workflow self-reconciliation will retry.",
    )
  }
  return {
    queued: true as const,
    runId: run.runId,
    generation: run.generation,
    ledgerRunId: ledger.id,
    workflowRunId: runtime.runId,
  }
}

export async function markRecommendationExperimentEvaluationRuntimeStarted(
  input: RecommendationExperimentEvaluationJobInput,
  runtimeRunId: string,
): Promise<void> {
  await Promise.all([
    input.ledgerRunId
      ? markWorkflowRunRuntimeStarted(input.ledgerRunId, runtimeRunId)
      : Promise.resolve(),
    prisma.recommendationExperimentEvaluationRun.updateMany({
      where: {
        id: input.runId,
        generation: input.expectedGeneration,
        state: RecommendationExperimentEvaluationRunState.PENDING,
        OR: [{ workflowRunId: null }, { workflowRunId: { not: runtimeRunId } }],
      },
      data: { workflowRunId: runtimeRunId },
    }),
  ])
}

export async function runRecommendationExperimentEvaluationJob(
  input: RecommendationExperimentEvaluationJobInput,
) {
  if (input.ledgerRunId) await markWorkflowRunStarted(input.ledgerRunId)
  const service = createRecommendationExperimentEvaluationService(prisma)
  const claim = await service.claimRun({
    runId: input.runId,
    expectedGeneration: input.expectedGeneration,
  })
  if (claim.status === "fenced") {
    await finishLedger(input.ledgerRunId, WorkflowRunStatus.SKIPPED, {
      status: "fenced",
      reason: "claim_unavailable",
    })
    return { status: "fenced" as const, reason: "claim_unavailable" }
  }
  try {
    if (
      !(await service.heartbeat({
        runId: input.runId,
        expectedGeneration: input.expectedGeneration,
        claimId: claim.claimId,
      }))
    ) {
      await finishLedger(input.ledgerRunId, WorkflowRunStatus.SKIPPED, {
        status: "fenced",
        reason: "claim_lost",
      })
      return { status: "fenced" as const, reason: "claim_lost" }
    }
    const result = await service.evaluateClaimedRun({
      runId: input.runId,
      expectedGeneration: input.expectedGeneration,
      expectedExperimentGeneration: input.expectedExperimentGeneration,
      claimId: claim.claimId,
    })
    if (result.status !== "fenced" && result.state === "fail") {
      await dispatchAutomaticRecommendationRollback({
        evaluationId: result.evaluationId,
      })
    }
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
        reason: "evaluation_failed",
      })
      .catch(() => false)
    if (input.ledgerRunId)
      await markWorkflowRunFailed(input.ledgerRunId, error).catch(() => {})
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
          ? "Recommendation experiment evaluation completed."
          : "Recommendation experiment evaluation fenced.",
      details: result,
      finishedAt: new Date(),
    },
  })
}

import { WorkflowRunStatus } from "@prisma/client"
import { start } from "workflow/api"
import { prisma } from "@/db/client"
import {
  attachWorkflowRuntimeRunId,
  createWorkflowRunLog,
  markWorkflowRunFailed,
  markWorkflowRunRuntimeStarted,
  markWorkflowRunStarted,
} from "@/services/workflow-run-log.service"
import { runRecommendationShadowEvaluation } from "@/workflows/recommendationShadowEvaluation"
import {
  HYBRID_CANDIDATE_GENERATOR_SET_VERSION,
  SEMANTIC_CANDIDATE_GENERATOR_VERSION,
  type CandidateNomination,
} from "../candidate"
import { createDatabaseProfileSourceNominationGenerator } from "../candidates/profile-candidate.service"
import {
  claimNextShadowRun,
  completeShadowEvaluation,
  executeClaimedShadowRun,
  failClaimedShadowRun,
  heartbeatShadowRun,
  sampleShadowEvaluationContexts,
  sampleProfileShadowEvaluationContexts,
  type ShadowGenerator,
} from "./service"

export const RECOMMENDATION_SHADOW_EVALUATION_WORKFLOW_KEY =
  "recommendation-shadow-evaluation"
export const SEMANTIC_AA_SHADOW_GENERATOR_KEY = "semantic-aa-v1"
export const HYBRID_PERSONALIZED_SHADOW_GENERATOR_KEY =
  HYBRID_CANDIDATE_GENERATOR_SET_VERSION

export type RecommendationShadowEvaluationJobInput = Readonly<{
  evaluationId: string
  expectedGeneration: number
  generatorKey: string
  minimumRuns: number
  ledgerRunId?: string
}>

export async function dispatchRecommendationShadowEvaluation(
  input: Omit<RecommendationShadowEvaluationJobInput, "ledgerRunId">,
  options: Readonly<{ actorId?: string }> = {},
): Promise<{ queued: true; ledgerRunId: string; runId: string }> {
  const ledger = await createWorkflowRunLog({
    workflowKey: RECOMMENDATION_SHADOW_EVALUATION_WORKFLOW_KEY,
    workflowName: "Recommendation Shadow Candidate Evaluation",
    trigger: options.actorId ? "manual" : "system",
    actorId: options.actorId,
    subjectType: "recommendation-shadow-evaluation",
    subjectId: input.evaluationId,
    summary: "Recommendation shadow evaluation queued.",
    details: {
      evaluationId: input.evaluationId,
      expectedGeneration: input.expectedGeneration,
      generatorKey: input.generatorKey,
      minimumRuns: input.minimumRuns,
    },
  })
  let runtime: Awaited<ReturnType<typeof start>>
  try {
    runtime = await start(runRecommendationShadowEvaluation, [
      { ...input, ledgerRunId: ledger.id },
    ])
  } catch (error) {
    await markWorkflowRunFailed(ledger.id, error).catch(() => {})
    throw error
  }
  await attachWorkflowRuntimeRunId(ledger.id, runtime.runId).catch(() => {
    console.warn(
      "Recommendation shadow evaluation started before its runtime identity could be recorded; workflow self-reconciliation will retry.",
    )
  })
  return { queued: true, ledgerRunId: ledger.id, runId: runtime.runId }
}

export async function markRecommendationShadowEvaluationRuntimeStarted(
  ledgerRunId: string | undefined,
  runtimeRunId: string,
): Promise<void> {
  if (!ledgerRunId) return
  await markWorkflowRunRuntimeStarted(ledgerRunId, runtimeRunId)
}

export async function runRecommendationShadowEvaluationJob(
  input: RecommendationShadowEvaluationJobInput,
): Promise<{
  status: "decided" | "fenced"
  decision?: string
  reason?: string
  processedRuns: number
  failedRuns: number
}> {
  if (input.ledgerRunId) await markWorkflowRunStarted(input.ledgerRunId)
  let processedRuns = 0
  let failedRuns = 0
  try {
    const sampled = await (
      input.generatorKey === HYBRID_PERSONALIZED_SHADOW_GENERATOR_KEY
        ? sampleProfileShadowEvaluationContexts
        : sampleShadowEvaluationContexts
    )(prisma, {
      evaluationId: input.evaluationId,
      expectedGeneration: input.expectedGeneration,
    })
    if (sampled.status === "fenced") {
      return finishFenced(input, sampled.reason, processedRuns, failedRuns)
    }

    const generator = resolveShadowGenerator(input.generatorKey)
    while (true) {
      const claim = await claimNextShadowRun(prisma, {
        evaluationId: input.evaluationId,
        expectedGeneration: input.expectedGeneration,
      })
      if (claim.status === "empty") break
      if (claim.status === "fenced") continue

      const heartbeat = await heartbeatShadowRun(prisma, {
        runId: claim.runId,
        expectedRunGeneration: claim.generation,
        expectedEvaluationGeneration: input.expectedGeneration,
        claimId: claim.claimId,
      })
      if (!heartbeat) continue

      try {
        const result = await executeClaimedShadowRun(prisma, {
          runId: claim.runId,
          expectedRunGeneration: claim.generation,
          expectedEvaluationGeneration: input.expectedGeneration,
          claimId: claim.claimId,
          generator,
        })
        if (result.status === "published") processedRuns += 1
      } catch {
        failedRuns += 1
        await failClaimedShadowRun(prisma, {
          runId: claim.runId,
          expectedRunGeneration: claim.generation,
          expectedEvaluationGeneration: input.expectedGeneration,
          claimId: claim.claimId,
          reason: "shadow_generator_failed",
        })
      }
    }

    const completed = await completeShadowEvaluation(prisma, {
      evaluationId: input.evaluationId,
      expectedGeneration: input.expectedGeneration,
      minimumRuns: input.minimumRuns,
    })
    if (completed.status === "fenced") {
      return finishFenced(input, completed.reason, processedRuns, failedRuns)
    }
    if (input.ledgerRunId) {
      await prisma.workflowRun.update({
        where: { id: input.ledgerRunId },
        data: {
          status: WorkflowRunStatus.SUCCEEDED,
          summary: `Recommendation shadow evaluation decided ${completed.decision}.`,
          finishedAt: new Date(),
          details: {
            evaluationId: input.evaluationId,
            expectedGeneration: input.expectedGeneration,
            generatorKey: input.generatorKey,
            processedRuns,
            failedRuns,
            decision: completed.decision,
            decisionId: completed.decisionId,
          },
        },
      })
    }
    return {
      status: "decided",
      decision: completed.decision,
      processedRuns,
      failedRuns,
    }
  } catch (error) {
    if (input.ledgerRunId) {
      await markWorkflowRunFailed(input.ledgerRunId, error).catch(() => {})
    }
    throw error
  }
}

async function finishFenced(
  input: RecommendationShadowEvaluationJobInput,
  reason: string,
  processedRuns: number,
  failedRuns: number,
) {
  if (input.ledgerRunId) {
    await prisma.workflowRun.update({
      where: { id: input.ledgerRunId },
      data: {
        status: WorkflowRunStatus.SKIPPED,
        summary: `Recommendation shadow evaluation fenced: ${reason}.`,
        finishedAt: new Date(),
        details: {
          evaluationId: input.evaluationId,
          expectedGeneration: input.expectedGeneration,
          generatorKey: input.generatorKey,
          processedRuns,
          failedRuns,
          reason,
        },
      },
    })
  }
  return {
    status: "fenced" as const,
    reason,
    processedRuns,
    failedRuns,
  }
}

export function resolveShadowGenerator(generatorKey: string): ShadowGenerator {
  if (generatorKey === SEMANTIC_AA_SHADOW_GENERATOR_KEY) {
    return semanticAaShadowGenerator
  }
  if (generatorKey === HYBRID_PERSONALIZED_SHADOW_GENERATOR_KEY) {
    return createHybridPersonalizedShadowGenerator(
      createDatabaseProfileSourceNominationGenerator(prisma),
    )
  }
  throw new RangeError(`Unsupported shadow generator key: ${generatorKey}`)
}

const semanticAaShadowGenerator: ShadowGenerator = async (context) => ({
  nominations: context.liveItems.map(
    (item, index): CandidateNomination => ({
      nominationKey: `semantic-aa:${index + 1}:${item.targetMediaId}`.slice(
        0,
        191,
      ),
      targetMediaId: item.targetMediaId,
      canonicalIdentity: {
        videoId: item.targetMediaId,
        videoCoreId: null,
        videoTitle: item.presentation.videoTitle,
        embeddingText: null,
      },
      presentation: item.presentation,
      action: {
        kind: "scene_start",
        startSeconds: item.presentation.startSeconds,
      },
      source: {
        generator: "semantic-aa",
        generatorVersion: SEMANTIC_AA_SHADOW_GENERATOR_KEY,
        rank: index + 1,
        score: Math.max(0, 1 - index / Math.max(1, context.liveItems.length)),
        evidence: { livePosition: item.position },
        rejectionReason: null,
      },
    }),
  ),
  projectionCapturedAt: new Date(),
  cohortQuality: null,
})

export function createHybridPersonalizedShadowGenerator(
  profileGenerator: ShadowGenerator,
): ShadowGenerator {
  return async (context) => {
    const profile = await profileGenerator(context)
    return {
      nominations: [
        ...semanticNominationsFromLiveItems(context),
        ...profile.nominations,
      ],
      projectionCapturedAt: profile.projectionCapturedAt,
      cohortQuality: profile.cohortQuality,
      sourceFailureReason: profile.sourceFailureReason ?? null,
    }
  }
}

function semanticNominationsFromLiveItems(
  context: Parameters<ShadowGenerator>[0],
): CandidateNomination[] {
  return context.liveItems.map((item, index) => ({
    nominationKey: `semantic:${index + 1}:${item.targetMediaId}`.slice(0, 191),
    targetMediaId: item.targetMediaId,
    canonicalIdentity: {
      videoId: item.targetMediaId,
      videoCoreId: null,
      videoTitle: item.presentation.videoTitle,
      embeddingText: null,
    },
    presentation: item.presentation,
    action: {
      kind: "scene_start",
      startSeconds: item.presentation.startSeconds,
    },
    source: {
      generator: "semantic",
      generatorVersion: SEMANTIC_CANDIDATE_GENERATOR_VERSION,
      rank: index + 1,
      score: Math.max(0, 1 - index / Math.max(1, context.liveItems.length)),
      evidence: { livePosition: item.position },
      rejectionReason: null,
    },
  }))
}

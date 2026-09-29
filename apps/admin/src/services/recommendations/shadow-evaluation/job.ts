import { WorkflowRunStatus } from "@prisma/client"
import { prisma } from "@/db/client"
import {
  finishRecommendationShadowDispatch,
  markRecommendationShadowEvaluationRuntimeStarted,
  type RecommendationShadowEvaluationJobInput,
} from "./dispatch"
export {
  dispatchRecommendationShadowEvaluation,
  markRecommendationShadowEvaluationRuntimeStarted,
  RECOMMENDATION_SHADOW_EVALUATION_WORKFLOW_KEY,
  type RecommendationShadowEvaluationJobInput,
} from "./dispatch"
import {
  HYBRID_CANDIDATE_GENERATOR_SET_VERSION,
  SEMANTIC_CANDIDATE_GENERATOR_VERSION,
  type CandidateNomination,
} from "../candidate"
import { createDatabaseProfileSourceNominationGenerator } from "../candidates/profile-candidate.service"
import {
  COWATCH_SHADOW_GENERATOR_KEY,
  createDatabaseCowatchShadowGenerator,
} from "../cowatch/candidate.service"
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

export const SEMANTIC_AA_SHADOW_GENERATOR_KEY = "semantic-aa-v1"
export const HYBRID_PERSONALIZED_SHADOW_GENERATOR_KEY =
  HYBRID_CANDIDATE_GENERATOR_SET_VERSION

export async function runRecommendationShadowEvaluationJob(
  input: RecommendationShadowEvaluationJobInput,
  runtimeRunId?: string,
): Promise<{
  status: "decided" | "fenced"
  decision?: string
  reason?: string
  processedRuns: number
  failedRuns: number
}> {
  if (
    input.ledgerRunId &&
    (!runtimeRunId ||
      !(await markRecommendationShadowEvaluationRuntimeStarted(
        input,
        runtimeRunId,
      )))
  ) {
    return {
      status: "fenced",
      reason: "dispatch_runtime_conflict",
      processedRuns: 0,
      failedRuns: 0,
    }
  }
  let processedRuns = 0
  let failedRuns = 0
  try {
    const sampled = await (
      input.generatorKey === HYBRID_PERSONALIZED_SHADOW_GENERATOR_KEY ||
        input.generatorKey === COWATCH_SHADOW_GENERATOR_KEY
        ? sampleProfileShadowEvaluationContexts
        : sampleShadowEvaluationContexts
    )(prisma, {
      evaluationId: input.evaluationId,
      expectedGeneration: input.expectedGeneration,
    })
    if (sampled.status === "fenced") {
      return finishFenced(
        input,
        runtimeRunId,
        sampled.reason,
        processedRuns,
        failedRuns,
      )
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
      return finishFenced(
        input,
        runtimeRunId,
        completed.reason,
        processedRuns,
        failedRuns,
      )
    }
    await finishRecommendationShadowDispatch(input, runtimeRunId, {
      status: WorkflowRunStatus.SUCCEEDED,
      summary: `Recommendation shadow evaluation decided ${completed.decision}.`,
      details: {
        processedRuns,
        failedRuns,
        decision: completed.decision,
        decisionId: completed.decisionId,
      },
    })
    return {
      status: "decided",
      decision: completed.decision,
      processedRuns,
      failedRuns,
    }
  } catch (error) {
    await finishRecommendationShadowDispatch(input, runtimeRunId, {
      status: WorkflowRunStatus.FAILED,
      summary:
        "Recommendation shadow evaluation failed; this dispatch cannot be restarted.",
      error: "shadow_evaluation_failed",
    }).catch(() => {})
    throw error
  }
}

async function finishFenced(
  input: RecommendationShadowEvaluationJobInput,
  runtimeRunId: string | undefined,
  reason: string,
  processedRuns: number,
  failedRuns: number,
) {
  await finishRecommendationShadowDispatch(input, runtimeRunId, {
    status: WorkflowRunStatus.SKIPPED,
    summary: `Recommendation shadow evaluation fenced: ${reason}.`,
    details: { processedRuns, failedRuns, reason },
  })
  return { status: "fenced" as const, reason, processedRuns, failedRuns }
}

export function resolveShadowGenerator(generatorKey: string): ShadowGenerator {
  if (generatorKey === SEMANTIC_AA_SHADOW_GENERATOR_KEY) {
    return semanticAaShadowGenerator
  }
  if (generatorKey === COWATCH_SHADOW_GENERATOR_KEY) {
    return createDatabaseCowatchShadowGenerator(prisma)
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

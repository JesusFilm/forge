import { getWorkflowMetadata } from "workflow"
import type { RecommendationShadowEvaluationJobInput } from "@/services/recommendations/shadow-evaluation/job"

export async function runRecommendationShadowEvaluation(
  input: RecommendationShadowEvaluationJobInput,
) {
  "use workflow"
  await stepMarkRecommendationShadowEvaluationStarted(input)
  return stepRunRecommendationShadowEvaluation(input)
}

async function stepMarkRecommendationShadowEvaluationStarted(
  input: RecommendationShadowEvaluationJobInput,
): Promise<void> {
  "use step"
  const { markRecommendationShadowEvaluationRuntimeStarted } =
    await import("@/services/recommendations/shadow-evaluation/job")
  await markRecommendationShadowEvaluationRuntimeStarted(
    input.ledgerRunId,
    getWorkflowMetadata().workflowRunId,
  )
}

async function stepRunRecommendationShadowEvaluation(
  input: RecommendationShadowEvaluationJobInput,
) {
  "use step"
  const { runRecommendationShadowEvaluationJob } =
    await import("@/services/recommendations/shadow-evaluation/job")
  return runRecommendationShadowEvaluationJob(input)
}

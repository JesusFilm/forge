import { getWorkflowMetadata } from "workflow"
import type { RecommendationShadowEvaluationJobInput } from "@/services/recommendations/shadow-evaluation/job"

export async function runRecommendationShadowEvaluation(
  input: RecommendationShadowEvaluationJobInput,
) {
  "use workflow"
  const runtimeRunId =
    await stepMarkRecommendationShadowEvaluationStarted(input)
  if (!runtimeRunId) {
    return {
      status: "fenced" as const,
      reason: "dispatch_runtime_conflict",
      processedRuns: 0,
      failedRuns: 0,
    }
  }
  return stepRunRecommendationShadowEvaluation(input, runtimeRunId)
}

async function stepMarkRecommendationShadowEvaluationStarted(
  input: RecommendationShadowEvaluationJobInput,
): Promise<string | null> {
  "use step"
  const { markRecommendationShadowEvaluationRuntimeStarted } =
    await import("@/services/recommendations/shadow-evaluation/job")
  const runtimeRunId = getWorkflowMetadata().workflowRunId
  return (await markRecommendationShadowEvaluationRuntimeStarted(
    input,
    runtimeRunId,
  ))
    ? runtimeRunId
    : null
}

async function stepRunRecommendationShadowEvaluation(
  input: RecommendationShadowEvaluationJobInput,
  runtimeRunId: string,
) {
  "use step"
  const { runRecommendationShadowEvaluationJob } =
    await import("@/services/recommendations/shadow-evaluation/job")
  return runRecommendationShadowEvaluationJob(input, runtimeRunId)
}

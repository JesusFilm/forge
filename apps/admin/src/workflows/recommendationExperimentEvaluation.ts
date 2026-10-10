import { getWorkflowMetadata } from "workflow"
import type { RecommendationExperimentEvaluationJobInput } from "@/services/recommendations/experiment/job"

export async function runRecommendationExperimentEvaluation(
  input: RecommendationExperimentEvaluationJobInput,
) {
  "use workflow"
  await stepMarkRecommendationExperimentEvaluationStarted(input)
  return stepRunRecommendationExperimentEvaluation(input)
}

async function stepMarkRecommendationExperimentEvaluationStarted(
  input: RecommendationExperimentEvaluationJobInput,
): Promise<void> {
  "use step"
  const { markRecommendationExperimentEvaluationRuntimeStarted } =
    await import("@/services/recommendations/experiment/job")
  await markRecommendationExperimentEvaluationRuntimeStarted(
    input,
    getWorkflowMetadata().workflowRunId,
  )
}

async function stepRunRecommendationExperimentEvaluation(
  input: RecommendationExperimentEvaluationJobInput,
) {
  "use step"
  const { runRecommendationExperimentEvaluationJob } =
    await import("@/services/recommendations/experiment/job")
  return runRecommendationExperimentEvaluationJob(input)
}

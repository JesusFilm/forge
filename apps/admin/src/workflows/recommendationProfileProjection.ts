import { getWorkflowMetadata } from "workflow"
import type { RecommendationProfileProjectionJobInput } from "@/services/recommendations/profiles/job"

export async function runRecommendationProfileProjection(
  input: RecommendationProfileProjectionJobInput,
) {
  "use workflow"
  await stepMarkRecommendationProfileProjectionStarted(input)
  return stepRunRecommendationProfileProjection(input)
}

async function stepMarkRecommendationProfileProjectionStarted(
  input: RecommendationProfileProjectionJobInput,
): Promise<void> {
  "use step"
  const { markRecommendationProfileProjectionRuntimeStarted } =
    await import("@/services/recommendations/profiles/job")
  await markRecommendationProfileProjectionRuntimeStarted(
    input,
    getWorkflowMetadata().workflowRunId,
  )
}

async function stepRunRecommendationProfileProjection(
  input: RecommendationProfileProjectionJobInput,
) {
  "use step"
  const { runRecommendationProfileProjectionJob } =
    await import("@/services/recommendations/profiles/job")
  return runRecommendationProfileProjectionJob(input)
}

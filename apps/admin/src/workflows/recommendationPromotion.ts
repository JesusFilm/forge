import { getWorkflowMetadata } from "workflow"
import type { RecommendationPromotionJobInput } from "@/services/recommendations/promotion/job"

export async function runRecommendationPromotion(
  input: RecommendationPromotionJobInput,
) {
  "use workflow"
  await stepMarkRecommendationPromotionStarted(input)
  return stepRunRecommendationPromotion(input)
}

async function stepMarkRecommendationPromotionStarted(
  input: RecommendationPromotionJobInput,
): Promise<void> {
  "use step"
  const { markRecommendationPromotionRuntimeStarted } =
    await import("@/services/recommendations/promotion/job")
  await markRecommendationPromotionRuntimeStarted(
    input,
    getWorkflowMetadata().workflowRunId,
  )
}

async function stepRunRecommendationPromotion(
  input: RecommendationPromotionJobInput,
) {
  "use step"
  const { runRecommendationPromotionJob } =
    await import("@/services/recommendations/promotion/job")
  return runRecommendationPromotionJob(input)
}

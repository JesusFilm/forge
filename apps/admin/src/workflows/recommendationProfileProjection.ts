import { RecommendationConflictError } from "@/services/recommendations/errors"

/** Historical workflow identity remains registered for stored replay. */
export async function runRecommendationProfileProjection(_input: {
  runId: string
  expectedGeneration: number
}): Promise<never> {
  "use workflow"
  throw new RecommendationConflictError("behavioral_recommendations_retired")
}

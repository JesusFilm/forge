/**
 * The recommendation operations mobile sends, by GraphQL operation name.
 * A dependency-free leaf: `authHeaders.ts` gates the fleet bearer on it and
 * `operations.ts` pins it to the shared documents.
 */
export const RECOMMENDATION_OPERATION_NAMES = [
  "UserRecommendations",
  "CreateRecommendationViewer",
  "UpdateRecommendationViewer",
  "RecordSemanticRecommendationEvidence",
  "SelectSemanticRecommendation",
  "ClaimSemanticRecommendationEpisode",
  "IssueWatchPlaybackContext",
  "RecordSemanticRecommendationPlayback",
] as const

export type RecommendationOperationName =
  (typeof RECOMMENDATION_OPERATION_NAMES)[number]

const RECOMMENDATION_OPERATIONS: ReadonlySet<string> = new Set(
  RECOMMENDATION_OPERATION_NAMES,
)

/**
 * Admin rejects a fleet bearer on these operations unless the variables also
 * prove a viewer handle, so the bearer is required here, not a bucket label.
 */
export function isRecommendationOperation(
  operationName: string | undefined,
): boolean {
  return operationName != null && RECOMMENDATION_OPERATIONS.has(operationName)
}

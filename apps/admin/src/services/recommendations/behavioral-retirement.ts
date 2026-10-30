import { RecommendationConflictError } from "./errors"

export const BEHAVIORAL_RETIREMENT_REASON = "behavioral_recommendations_retired"

/** Compatibility boundary until the retired operators and schema are removed. */
export function refuseBehavioralRecommendations(): never {
  throw new RecommendationConflictError(BEHAVIORAL_RETIREMENT_REASON)
}

export function requireContentOnlyManifest(manifestId: string | null): void {
  if (
    manifestId !== "semantic-transcript-pgvector-v1" &&
    manifestId !== "semantic-experiment-aa-v1"
  ) {
    refuseBehavioralRecommendations()
  }
}

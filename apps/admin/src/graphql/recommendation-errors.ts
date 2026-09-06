import { GraphQLError } from "graphql"
import { ZodError } from "zod"
import {
  RecommendationAuthenticationError,
  RecommendationCapabilityUnavailableError,
  RecommendationConflictError,
  RecommendationServiceError,
} from "@/services/recommendations/errors"
import { RecommendationTokenInvalidError } from "@/services/recommendations/token.service"

/**
 * Keep the recommendation GraphQL surface deliberately small and public-safe.
 * Services expose typed domain failures; unexpected storage/runtime failures
 * continue to Yoga's generic internal-error formatter.
 */
function toRecommendationGraphQLError(error: unknown): GraphQLError {
  if (error instanceof RecommendationAuthenticationError) {
    return new GraphQLError(error.message, {
      extensions: { code: "UNAUTHENTICATED" },
    })
  }
  if (
    error instanceof RecommendationServiceError ||
    error instanceof RecommendationTokenInvalidError ||
    error instanceof ZodError
  ) {
    const message =
      error instanceof RecommendationServiceError
        ? error.message
        : "Recommendation request is invalid"
    const code =
      error instanceof RecommendationCapabilityUnavailableError
        ? "SERVICE_UNAVAILABLE"
        : error instanceof RecommendationConflictError
          ? "CONFLICT"
          : "BAD_USER_INPUT"
    return new GraphQLError(message, { extensions: { code } })
  }
  throw error
}

export async function resolveRecommendationOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw toRecommendationGraphQLError(error)
  }
}

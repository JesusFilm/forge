import type { Principal } from "@/auth/principal"
import { RecommendationAuthenticationError } from "./errors"

export function assertWebRecommendationCaller(
  caller: Principal | null,
): asserts caller is Principal & {
  role: "CONSUMER_BEARER"
  rateLimitBucketKey: string
} {
  if (
    caller?.role !== "CONSUMER_BEARER" ||
    caller.fleet === true ||
    typeof caller.rateLimitBucketKey !== "string" ||
    caller.rateLimitBucketKey.length === 0
  ) {
    throw new RecommendationAuthenticationError()
  }
}

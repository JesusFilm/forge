import "server-only"
import { RecommendationRuntimeError } from "./recommendation-errors"
import { RecommendationRouteError } from "./recommendation-route-policy"

const RESULTS = new Set(["served", "fallback", "empty", "unavailable"])
// Never log upstream strings directly: even a new reason must have bounded
// cardinality and cannot smuggle capabilities or other identifying values.
const REASONS = new Set([
  "delivery_timeout",
  "retrieval_timeout",
  "delivery_unavailable",
  "retrieval_unavailable",
  "persistence_unavailable",
  "admission_unavailable",
  "in_flight",
  "cooldown",
  "session_hour",
  "endpoint_rate",
  "rate_limited",
  "environment_disabled",
  "keyring_unavailable",
  "retention_overdue",
  "manifest_missing",
  "manifest_incompatible",
  "control_disabled",
  "coverage_unavailable",
  "response_oversized",
  "service_unavailable",
  "issuance_failed",
  "seed_embedding_unavailable",
  "candidate_pool_stale",
  "candidate_pool_fallback",
  "candidate_pool_ineligible",
  "semantic_parity_mismatch",
  "last_known_good_semantic_fallback",
  "no_candidates",
  "profile_lineage_ineligible",
  "profile_projection_unavailable",
  "profile_retrieval_timeout",
  "profile_candidates_sparse",
  "semantic_candidates_unavailable",
  "hybrid_candidate_platform_unavailable",
  "hybrid_slate_empty",
  "candidate_platform_unavailable",
  "recent_context_unavailable",
  "feature_disabled",
  "invalid_input",
  "invalid_session",
  "invalid_body",
  "invalid_json",
  "invalid_origin",
  "invalid_fetch_metadata",
  "invalid_content_type",
  "invalid_content_length",
  "content_encoding_not_allowed",
  "body_too_large",
  "invalid_admin_response",
])

type DeliveryObservation = {
  endpoint: "seeded" | "for_you"
  httpStatus: number
  delivery?: {
    result: string
    reason?: string | null
    items: readonly unknown[]
  }
  upstreamResult?: string
  error?: unknown
}

export function observeRecommendationDelivery(
  input: DeliveryObservation,
  log: (message: string) => void = (message) => console.info(message),
): void {
  try {
    const { delivery, error, httpStatus } = input
    const reason = delivery
      ? delivery.reason
      : error instanceof RecommendationRouteError ||
          error instanceof RecommendationRuntimeError
        ? error.code
        : "unknown"
    const count = delivery?.items.length ?? 0
    const event = {
      event: "recommendation.delivery",
      endpoint:
        input.endpoint === "seeded" || input.endpoint === "for_you"
          ? input.endpoint
          : "unknown",
      httpStatus:
        Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599
          ? httpStatus
          : "unknown",
      result:
        httpStatus >= 500
          ? "failed"
          : httpStatus >= 400
            ? "rejected"
            : delivery && RESULTS.has(delivery.result)
              ? delivery.result
              : "unknown",
      reason:
        reason == null ? "none" : REASONS.has(reason) ? reason : "unknown",
      itemCount:
        Number.isInteger(count) && count >= 0 && count <= 6
          ? count
          : "out_of_range",
      upstreamResult:
        input.upstreamResult == null
          ? "not_observed"
          : RESULTS.has(input.upstreamResult)
            ? input.upstreamResult
            : "unknown",
    }
    log(
      Object.entries(event)
        .map(([key, value]) => `${key}=${value}`)
        .join(" "),
    )
  } catch {
    // Operational telemetry cannot change the response or block playback.
  }
}

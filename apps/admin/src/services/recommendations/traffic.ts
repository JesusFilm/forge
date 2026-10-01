import type { Principal } from "@/auth/principal"
import { assertWebRecommendationCaller } from "./caller"
import {
  RecommendationAuthenticationError,
  RecommendationInputError,
} from "./errors"

export const RECOMMENDATION_TRAFFIC_CATEGORIES = [
  "declared_crawler",
  "speculative_prefetch",
  "speculative_prerender",
  "ordinary_browser",
  "unknown",
] as const
export type RecommendationTrafficCategory =
  (typeof RECOMMENDATION_TRAFFIC_CATEGORIES)[number]
export const CONTEXTUAL_RECOMMENDATION_CAPABILITY =
  "contextual-fallback-unattributed-v1"

/** Classification is asserted by the authenticated Web origin, never a viewer. */
export function recommendationTraffic(input: {
  caller: Principal | null
  trafficCategory?: string | null
  eligibleHuman?: boolean
}) {
  assertWebRecommendationCaller(input.caller)
  if (input.trafficCategory != null && input.caller.fleet === true)
    throw new RecommendationAuthenticationError()
  if (
    input.trafficCategory != null &&
    !RECOMMENDATION_TRAFFIC_CATEGORIES.some(
      (value) => value === input.trafficCategory,
    )
  )
    throw new RecommendationInputError(
      "Invalid recommendation traffic category",
    )
  const category = (input.trafficCategory ??
    "unknown") as RecommendationTrafficCategory
  const deferred =
    category === "speculative_prefetch" || category === "speculative_prerender"
  return {
    category,
    disposition: deferred
      ? ("deferred" as const)
      : category === "declared_crawler" || input.eligibleHuman === false
        ? ("contextual" as const)
        : ("measured" as const),
    reason:
      input.eligibleHuman === false &&
      !deferred &&
      category !== "declared_crawler"
        ? ("legacy_ineligible" as const)
        : ("origin_classification" as const),
  }
}

/** A bounded counter event; no identity, input text, credentials or durable ledger. */
export function observeRecommendationTraffic(
  surface: "seeded" | "for_you",
  traffic: ReturnType<typeof recommendationTraffic>,
  phase:
    | "attempted"
    | "persistence_avoided"
    | "committed"
    | "contextual_fallback"
    | "deferred",
) {
  try {
    console.info(
      JSON.stringify({
        event: "recommendation.traffic",
        schemaVersion: 1,
        classifierVersion: "origin-traffic-v1",
        surface,
        category: traffic.category,
        disposition: traffic.disposition,
        reason: traffic.reason,
        phase,
        count: 1,
      }),
    )
  } catch {
    /* Observation never changes serving. */
  }
}

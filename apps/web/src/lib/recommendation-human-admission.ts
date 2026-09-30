import { RecommendationRouteError } from "@/lib/recommendation-route-policy"

const MACHINE_USER_AGENT =
  /(?:bot|crawler|spider|headless|lighthouse|slurp|bingpreview|facebookexternalhit|meta-external(?:agent|fetcher))/i

export const RECOMMENDATION_TRAFFIC_CLASSIFIER_VERSION = "origin-traffic-v1"
export type RecommendationTrafficCategory =
  | "declared_crawler"
  | "speculative_prefetch"
  | "speculative_prerender"
  | "ordinary_browser"
  | "unknown"

// Declared metadata is a disposition signal, never proof of humanity or edge trust.
export function classifyRecommendationTraffic(
  request: Pick<Request, "headers">,
): RecommendationTrafficCategory {
  const userAgent = request.headers.get("user-agent")
  if (userAgent && MACHINE_USER_AGENT.test(userAgent)) return "declared_crawler"
  const purpose = [
    request.headers.get("purpose"),
    request.headers.get("sec-purpose"),
  ]
    .filter(Boolean)
    .join(";")
  if (/\bprerender\b/i.test(purpose)) return "speculative_prerender"
  if (/\bprefetch\b/i.test(purpose)) return "speculative_prefetch"
  return userAgent?.trim() ? "ordinary_browser" : "unknown"
}

export function recommendationTrafficExcluded(
  category: RecommendationTrafficCategory,
): boolean {
  return (
    category === "declared_crawler" ||
    category === "speculative_prefetch" ||
    category === "speculative_prerender"
  )
}

export function recommendationDeliveryDisposition(
  category: RecommendationTrafficCategory,
) {
  return category === "declared_crawler"
    ? "contextual"
    : recommendationTrafficExcluded(category)
      ? "deferred"
      : "measured"
}

// Compatibility name: admitted unknown traffic is not proven human.
export function isEligibleHumanRequest(
  request: Pick<Request, "headers">,
): boolean {
  return !recommendationTrafficExcluded(classifyRecommendationTraffic(request))
}

export function assertRecommendationHumanAdmission(
  request: Pick<Request, "headers">,
): void {
  if (!isEligibleHumanRequest(request)) {
    throw new RecommendationRouteError(403, "machine_evidence_rejected")
  }
}

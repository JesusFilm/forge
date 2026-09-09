import { RecommendationRouteError } from "@/lib/recommendation-route-policy"

const MACHINE_USER_AGENT =
  /(?:bot|crawler|spider|headless|lighthouse|slurp|bingpreview|facebookexternalhit)/i

// This is recognized-machine exclusion, not proof that unknown traffic is human.
// No machine evidence mutation is supported by the public Watch boundary.
export function isEligibleHumanRequest(
  request: Pick<Request, "headers">,
): boolean {
  const purpose = [
    request.headers.get("purpose"),
    request.headers.get("sec-purpose"),
  ]
    .filter(Boolean)
    .join(";")
  if (/\b(?:prefetch|prerender)\b/i.test(purpose)) return false
  const userAgent = request.headers.get("user-agent")
  return userAgent == null || !MACHINE_USER_AGENT.test(userAgent)
}

export function assertRecommendationHumanAdmission(
  request: Pick<Request, "headers">,
): void {
  if (!isEligibleHumanRequest(request)) {
    throw new RecommendationRouteError(403, "machine_evidence_rejected")
  }
}

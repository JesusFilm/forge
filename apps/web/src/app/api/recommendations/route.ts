import { z } from "zod"
import { WATCH_CANONICAL_ORIGIN } from "@/lib/routes"
import { getSemanticRecommendationDelivery } from "@/lib/recommendations"
import {
  RECOMMENDATION_DELIVERY_BODY_BYTES,
  RECOMMENDATION_DELIVERY_RESPONSE_BYTES,
  RecommendationRouteError,
  readStrictRecommendationJson,
} from "@/lib/recommendation-route-policy"
import { assertRecommendationMutationAdmission } from "@/lib/recommendation-mutation-admission"
import {
  recommendationError,
  recommendationSerializedJson,
} from "@/lib/recommendation-route-response"
import {
  attachRecommendationSession,
  ensureRecommendationSession,
  readRecommendationProfileCookie,
} from "@/lib/recommendation-session"
import { readRecommendationConsentCookie } from "@/lib/recommendation-consent"
import { requestHasRecommendationWithdrawalPending } from "@/lib/recommendation-withdrawal-pending"

export const dynamic = "force-dynamic"
export const revalidate = 0

const DeliveryInput = z
  .object({
    seedMediaId: z.string().min(1).max(191),
    locale: z.string().regex(/^[A-Za-z0-9-]{1,32}$/),
    audioLanguageSlug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  })
  .strict()

const MACHINE_USER_AGENT =
  /(?:bot|crawler|spider|headless|lighthouse|slurp|bingpreview|facebookexternalhit)/i

function isEligibleHumanRequest(request: Request): boolean {
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

export async function POST(request: Request) {
  try {
    const raw = await readStrictRecommendationJson(request, {
      expectedOrigin: WATCH_CANONICAL_ORIGIN,
      maxBytes: RECOMMENDATION_DELIVERY_BODY_BYTES,
    })
    const parsed = DeliveryInput.safeParse(raw)
    if (!parsed.success) {
      throw new RecommendationRouteError(400, "invalid_body")
    }
    await assertRecommendationMutationAdmission(request.headers, "delivery")
    const session = ensureRecommendationSession(request)
    const profile = readRecommendationProfileCookie(request)
    const consent = readRecommendationConsentCookie(request)
    const withdrawalPending = requestHasRecommendationWithdrawalPending(request)
    const consentReceiptDigest =
      !withdrawalPending && consent.kind === "valid" ? consent.digest : null
    const delivery = await getSemanticRecommendationDelivery({
      ...parsed.data,
      sessionDigest: session.digest,
      consentReceiptDigest,
      profileTokenDigest:
        consentReceiptDigest != null && profile.kind === "valid"
          ? profile.digest
          : null,
      eligibleHuman: isEligibleHumanRequest(request),
    })
    const serialized = JSON.stringify({ delivery })
    if (
      new TextEncoder().encode(serialized).byteLength >
      RECOMMENDATION_DELIVERY_RESPONSE_BYTES
    ) {
      throw new RecommendationRouteError(502, "invalid_admin_response")
    }
    const response = recommendationSerializedJson(serialized)
    attachRecommendationSession(response, session)
    return response
  } catch (error) {
    return recommendationError(error)
  }
}

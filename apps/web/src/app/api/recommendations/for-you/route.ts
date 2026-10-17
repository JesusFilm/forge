import {
  classifyRecommendationTraffic,
  recommendationTrafficExcluded,
  recommendationDeliveryDisposition,
} from "@/lib/recommendation-human-admission"
import { CONTEXTUAL_RECOMMENDATION_FALLBACK_CAPABILITY } from "@/lib/recommendation-contracts"
import { observeRecommendationDelivery } from "@/lib/recommendation-delivery-observability"
import { z } from "zod"
import { getUserRecommendations } from "@/lib/user-recommendations"
import { homepageRecommendationsEnabled } from "@/lib/homepage-recommendations-flag"
import { WATCH_CANONICAL_ORIGIN } from "@/lib/routes"
import {
  readStrictRecommendationJson,
  RecommendationRouteError,
  RECOMMENDATION_DELIVERY_BODY_BYTES,
  RECOMMENDATION_DELIVERY_RESPONSE_BYTES,
} from "@/lib/recommendation-route-policy"
import { assertRecommendationMutationAdmission } from "@/lib/recommendation-mutation-admission"
import {
  recommendationSerializedJson,
  recommendationError,
} from "@/lib/recommendation-route-response"
import {
  ensureRecommendationSession,
  readRecommendationProfileCookie,
  attachRecommendationSession,
} from "@/lib/recommendation-session"
import { readRecommendationConsentCookie } from "@/lib/recommendation-consent"
import { requestHasRecommendationWithdrawalPending } from "@/lib/recommendation-withdrawal-pending"

export const dynamic = "force-dynamic"
export const revalidate = 0
const Input = z
  .object({
    locale: z.string().regex(/^[A-Za-z0-9-]{1,32}$/),
    audioLanguageSlug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  })
  .strict()
export async function POST(request: Request) {
  const trafficCategory = classifyRecommendationTraffic(request)
  const excluded = recommendationTrafficExcluded(trafficCategory)
  const deliveryDisposition = recommendationDeliveryDisposition(trafficCategory)
  try {
    const raw = await readStrictRecommendationJson(request, {
      expectedOrigin: WATCH_CANONICAL_ORIGIN,
      maxBytes: RECOMMENDATION_DELIVERY_BODY_BYTES,
    })
    const parsed = Input.safeParse(raw)
    if (!parsed.success) throw new RecommendationRouteError(400, "invalid_body")
    if (!(await homepageRecommendationsEnabled(request)))
      throw new RecommendationRouteError(403, "feature_disabled")
    await assertRecommendationMutationAdmission(request.headers, "delivery")
    const session = excluded ? null : ensureRecommendationSession(request),
      profile = excluded ? null : readRecommendationProfileCookie(request),
      consent = excluded ? null : readRecommendationConsentCookie(request)
    const consentReceiptDigest =
      !requestHasRecommendationWithdrawalPending(request) &&
      consent?.kind === "valid"
        ? consent.digest
        : null
    const upstreamDelivery = await getUserRecommendations({
      trafficCategory,
      ...parsed.data,
      sessionDigest: session?.digest ?? "0".repeat(64),
      consentReceiptDigest,
      profileTokenDigest:
        consentReceiptDigest && profile?.kind === "valid"
          ? profile.digest
          : null,
    })
    const delivery = excluded
      ? {
          ...upstreamDelivery,
          requestId: null,
          expiresAt: null,
          personalization: null,
          items:
            deliveryDisposition === "deferred"
              ? []
              : upstreamDelivery.items.map((item) => ({
                  ...item,
                  capability: CONTEXTUAL_RECOMMENDATION_FALLBACK_CAPABILITY,
                })),
        }
      : upstreamDelivery
    const serialized = JSON.stringify({ delivery, deliveryDisposition })
    if (Buffer.byteLength(serialized) > RECOMMENDATION_DELIVERY_RESPONSE_BYTES)
      throw new RecommendationRouteError(502, "invalid_admin_response")
    const response = recommendationSerializedJson(serialized)
    if (session) attachRecommendationSession(response, session)
    observeRecommendationDelivery({
      endpoint: "for_you",
      trafficCategory,
      persistenceDisposition: excluded
        ? upstreamDelivery.requestId
          ? "unexpected_commit"
          : "avoided"
        : upstreamDelivery.requestId
          ? "committed"
          : "not_committed",
      httpStatus: response.status,
      delivery,
      upstreamResult: delivery.result,
    })
    return response
  } catch (error) {
    const response = recommendationError(error)
    observeRecommendationDelivery({
      endpoint: "for_you",
      trafficCategory,
      persistenceDisposition: "not_observed",
      httpStatus: response.status,
      error,
    })
    return response
  }
}

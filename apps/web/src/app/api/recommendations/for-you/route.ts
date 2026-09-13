import { z } from "zod"
import { getUserRecommendations } from "@/lib/user-recommendations"
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
  try {
    const raw = await readStrictRecommendationJson(request, {
      expectedOrigin: WATCH_CANONICAL_ORIGIN,
      maxBytes: RECOMMENDATION_DELIVERY_BODY_BYTES,
    })
    const parsed = Input.safeParse(raw)
    if (!parsed.success) throw new RecommendationRouteError(400, "invalid_body")
    await assertRecommendationMutationAdmission(request.headers, "delivery")
    const session = ensureRecommendationSession(request),
      profile = readRecommendationProfileCookie(request),
      consent = readRecommendationConsentCookie(request)
    const consentReceiptDigest =
      !requestHasRecommendationWithdrawalPending(request) &&
      consent.kind === "valid"
        ? consent.digest
        : null
    const delivery = await getUserRecommendations({
      ...parsed.data,
      sessionDigest: session.digest,
      consentReceiptDigest,
      profileTokenDigest:
        consentReceiptDigest && profile.kind === "valid"
          ? profile.digest
          : null,
    })
    const serialized = JSON.stringify({ delivery })
    if (Buffer.byteLength(serialized) > RECOMMENDATION_DELIVERY_RESPONSE_BYTES)
      throw new RecommendationRouteError(502, "invalid_admin_response")
    const response = recommendationSerializedJson(serialized)
    attachRecommendationSession(response, session)
    return response
  } catch (error) {
    return recommendationError(error)
  }
}

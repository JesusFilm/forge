import { z } from "zod"
import {
  asLocaleSlug,
  tryAsContentSlug,
  watchVideoPath,
  WATCH_BASE_PATH,
  WATCH_CANONICAL_ORIGIN,
} from "@/lib/routes"
import {
  getContextualSceneRecommendations,
  getSemanticRecommendationDelivery,
} from "@/lib/recommendations"
import { CONTEXTUAL_RECOMMENDATION_FALLBACK_CAPABILITY } from "@/lib/recommendation-contracts"
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

async function recoverContextualDelivery(
  delivery: Awaited<ReturnType<typeof getSemanticRecommendationDelivery>>,
  input: z.infer<typeof DeliveryInput>,
) {
  if (delivery.result !== "unavailable") return delivery
  let recommendations
  try {
    recommendations = await getContextualSceneRecommendations(
      input.seedMediaId,
      input.locale,
      6,
    )
  } catch {
    return delivery
  }
  const seenTargets = new Set<string>()
  const seenHrefs = new Set<string>()
  const items = recommendations.flatMap((recommendation) => {
    const slug = tryAsContentSlug(recommendation.videoSlug)
    if (!slug || seenTargets.has(recommendation.videoId)) return []
    const canonicalHref = `${WATCH_BASE_PATH}${watchVideoPath(
      slug,
      asLocaleSlug(input.audioLanguageSlug),
    )}`
    if (seenHrefs.has(canonicalHref)) return []
    const position = seenTargets.size
    if (position >= 6) return []
    seenTargets.add(recommendation.videoId)
    seenHrefs.add(canonicalHref)
    return [
      {
        ...recommendation,
        id: `contextual-${position}`,
        position,
        targetMediaId: recommendation.videoId,
        canonicalHref,
        candidateGenerator: "semantic" as const,
        contributors: [],
        capability: CONTEXTUAL_RECOMMENDATION_FALLBACK_CAPABILITY,
      },
    ]
  })
  if (items.length === 0) return delivery
  return {
    ...delivery,
    strategyVersion: "scene-recommendations-contextual-v1",
    classifierVersion: "contextual-fallback-v1",
    requestId: null,
    result: "fallback" as const,
    expiresAt: null,
    requestedCount: 6,
    composedCount: items.length,
    shortfallReason:
      items.length < 6 ? ("insufficient_candidates" as const) : null,
    items,
    personalization: {
      contractVersion: "anonymous-profile-personalization-v1" as const,
      lane: "semantic_fallback" as const,
      executionMode: "semantic_fallback" as const,
      effectiveManifestId: "scene-recommendations-contextual-v1",
      profileState: null,
      projectionVersion: null,
      projectionGeneration: null,
      interestCount: 0,
      sessionIntentPresent: false,
      reason: delivery.reason,
    },
  }
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
    const semanticDelivery = await getSemanticRecommendationDelivery({
      ...parsed.data,
      sessionDigest: session.digest,
      consentReceiptDigest,
      profileTokenDigest:
        consentReceiptDigest != null && profile.kind === "valid"
          ? profile.digest
          : null,
      eligibleHuman: isEligibleHumanRequest(request),
    })
    const delivery = await recoverContextualDelivery(
      semanticDelivery,
      parsed.data,
    )
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

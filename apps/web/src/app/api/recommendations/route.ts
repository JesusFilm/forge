import { z } from "zod"
import {
  asLocaleSlug,
  tryAsContentSlug,
  watchEpisodePath,
  watchVideoPath,
  WATCH_BASE_PATH,
  WATCH_CANONICAL_ORIGIN,
} from "@/lib/routes"
import {
  getContextualSceneRecommendations,
  getContextualCollectionRecommendations,
  getSemanticRecommendationDelivery,
} from "@/lib/recommendations"
import {
  CONTEXTUAL_RECOMMENDATION_FALLBACK_CAPABILITY,
  SEMANTIC_RECOMMENDATION_CONTRACT,
  WATCH_RECOMMENDATION_SURFACE,
} from "@/lib/recommendation-contracts"
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
import { resolvePosterUrl } from "@/lib/url"

export const dynamic = "force-dynamic"
export const revalidate = 0

const DeliveryInput = z
  .object({
    seedMediaId: z.string().min(1).max(191),
    seedMediaSlug: z
      .string()
      .max(191)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
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

function unavailableSemanticDelivery() {
  return {
    contractVersion: SEMANTIC_RECOMMENDATION_CONTRACT,
    surfaceVersion: WATCH_RECOMMENDATION_SURFACE,
    strategyVersion: "semantic-delivery-unavailable-v1",
    classifierVersion: "unavailable-v1",
    requestId: null,
    result: "unavailable" as const,
    reason: "delivery_unavailable",
    expiresAt: null,
    requestedCount: null,
    composedCount: null,
    shortfallReason: null,
    items: [],
    personalization: null,
  }
}

async function recoverContextualDelivery(
  delivery:
    | Awaited<ReturnType<typeof getSemanticRecommendationDelivery>>
    | ReturnType<typeof unavailableSemanticDelivery>,
  input: z.infer<typeof DeliveryInput>,
) {
  if (delivery.result !== "unavailable") return delivery
  const scenePromise = getContextualSceneRecommendations(
    input.seedMediaId,
    input.locale,
    6,
  ).catch(() => [])
  const collectionPromise = input.seedMediaSlug
    ? getContextualCollectionRecommendations(
        input.seedMediaSlug,
        input.locale,
        input.audioLanguageSlug,
        6,
      ).catch(() => [])
    : Promise.resolve([])
  const [sceneRecommendations, collectionRecommendations] = await Promise.all([
    scenePromise,
    collectionPromise,
  ])
  const recommendations =
    sceneRecommendations.length > 0
      ? sceneRecommendations
      : collectionRecommendations
  const seenTargets = new Set<string>()
  const seenHrefs = new Set<string>()
  const items = recommendations.flatMap((recommendation) => {
    const slug = tryAsContentSlug(recommendation.videoSlug)
    if (!slug || seenTargets.has(recommendation.videoId)) return []
    const languageSlug = asLocaleSlug(input.audioLanguageSlug)
    const collectionSlug = recommendation.collectionSlug
      ? tryAsContentSlug(recommendation.collectionSlug)
      : null
    const canonicalHref = `${WATCH_BASE_PATH}${
      collectionSlug
        ? watchEpisodePath(collectionSlug, slug, languageSlug)
        : watchVideoPath(slug, languageSlug)
    }`
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
  const collectionFallback = recommendations.some(
    (recommendation) => recommendation.collectionSlug != null,
  )
  return {
    ...delivery,
    strategyVersion: collectionFallback
      ? "collection-siblings-contextual-v1"
      : "scene-recommendations-contextual-v1",
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
      effectiveManifestId: collectionFallback
        ? "collection-siblings-contextual-v1"
        : "scene-recommendations-contextual-v1",
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
    const semanticInput = {
      seedMediaId: parsed.data.seedMediaId,
      locale: parsed.data.locale,
      audioLanguageSlug: parsed.data.audioLanguageSlug,
    }
    const semanticDelivery = await getSemanticRecommendationDelivery({
      ...semanticInput,
      sessionDigest: session.digest,
      consentReceiptDigest,
      profileTokenDigest:
        consentReceiptDigest != null && profile.kind === "valid"
          ? profile.digest
          : null,
      eligibleHuman: isEligibleHumanRequest(request),
    }).catch(() => unavailableSemanticDelivery())
    const recoveredDelivery = await recoverContextualDelivery(
      semanticDelivery,
      parsed.data,
    )
    const delivery = {
      ...recoveredDelivery,
      items: recoveredDelivery.items.map((item) => ({
        ...item,
        imageUrl: resolvePosterUrl(
          { thumbnail: item.imageUrl },
          item.playbackId,
        ),
      })),
    }
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

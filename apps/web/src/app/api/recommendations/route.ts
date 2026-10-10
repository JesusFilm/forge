import { observeRecommendationDelivery } from "@/lib/recommendation-delivery-observability"
import {
  classifyRecommendationTraffic,
  recommendationTrafficExcluded,
  recommendationDeliveryDisposition,
} from "@/lib/recommendation-human-admission"
import { z } from "zod"
import { tryAsContentSlug, WATCH_CANONICAL_ORIGIN } from "@/lib/routes"
import { getSemanticRecommendationDelivery } from "@/lib/recommendations"
import {
  CONTEXTUAL_RECOMMENDATION_FALLBACK_CAPABILITY,
  RECOMMENDATION_DELIVERY_CLIENT_VERSION,
  COWATCH_MMR_CLIENT_DELIVERY_CONTRACT,
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
      .refine((value) => tryAsContentSlug(value) != null)
      .optional(),
    locale: z.string().regex(/^[A-Za-z0-9-]{1,32}$/),
    audioLanguageSlug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  })
  .strict()

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

export async function POST(request: Request) {
  const trafficCategory = classifyRecommendationTraffic(request)
  const excluded = recommendationTrafficExcluded(trafficCategory)
  const deliveryDisposition = recommendationDeliveryDisposition(trafficCategory)
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
    const session = excluded ? null : ensureRecommendationSession(request)
    const profile = excluded ? null : readRecommendationProfileCookie(request)
    const consent = excluded ? null : readRecommendationConsentCookie(request)
    const withdrawalPending = requestHasRecommendationWithdrawalPending(request)
    const consentReceiptDigest =
      !withdrawalPending && consent?.kind === "valid" ? consent.digest : null
    const semanticInput = {
      seedMediaId: parsed.data.seedMediaId,
      locale: parsed.data.locale,
      audioLanguageSlug: parsed.data.audioLanguageSlug,
    }
    let upstreamAcknowledged = true
    const semanticDelivery = await getSemanticRecommendationDelivery({
      ...semanticInput,
      sessionDigest: session?.digest ?? "0".repeat(64),
      consentReceiptDigest,
      profileTokenDigest:
        consentReceiptDigest != null && profile?.kind === "valid"
          ? profile.digest
          : null,
      eligibleHuman: !excluded,
      clientDeliveryContract:
        request.headers.get("x-forge-recommendation-delivery-contract") ===
        COWATCH_MMR_CLIENT_DELIVERY_CONTRACT
          ? COWATCH_MMR_CLIENT_DELIVERY_CONTRACT
          : null,
      trafficCategory,
    }).catch(() => {
      upstreamAcknowledged = false
      return unavailableSemanticDelivery()
    })
    // Admin owns exact-audio and published-presentation eligibility. Legacy
    // scene and collection APIs cannot attest those facts, so their cards
    // must not replace an empty or unavailable delivery.
    const admittedDelivery =
      deliveryDisposition === "deferred"
        ? { ...unavailableSemanticDelivery(), reason: "traffic_deferred" }
        : semanticDelivery
    const delivery = {
      ...admittedDelivery,
      ...(excluded ? { requestId: null, expiresAt: null } : {}),
      // Older open tabs strictly validate execution modes. Preserve their
      // cards and attribution without mislabeling the new mode as topic fit.
      personalization: excluded
        ? null
        : admittedDelivery.personalization?.executionMode ===
              "viewing_mode_personalized" &&
            request.headers.get("x-forge-recommendation-client") !==
              RECOMMENDATION_DELIVERY_CLIENT_VERSION
          ? null
          : admittedDelivery.personalization,
      items: admittedDelivery.items.map((item) => ({
        ...item,
        ...(excluded
          ? { capability: CONTEXTUAL_RECOMMENDATION_FALLBACK_CAPABILITY }
          : {}),
        imageUrl: resolvePosterUrl(
          { thumbnail: item.imageUrl },
          item.playbackId,
        ),
      })),
    }
    const serialized = JSON.stringify({ delivery, deliveryDisposition })
    if (
      new TextEncoder().encode(serialized).byteLength >
      RECOMMENDATION_DELIVERY_RESPONSE_BYTES
    ) {
      throw new RecommendationRouteError(502, "invalid_admin_response")
    }
    const response = recommendationSerializedJson(serialized)
    if (session) attachRecommendationSession(response, session)
    observeRecommendationDelivery({
      endpoint: "seeded",
      trafficCategory,
      persistenceDisposition: !upstreamAcknowledged
        ? "not_observed"
        : excluded
          ? semanticDelivery.requestId
            ? "unexpected_commit"
            : "avoided"
          : semanticDelivery.requestId
            ? "committed"
            : "not_committed",
      httpStatus: response.status,
      delivery,
      upstreamResult: semanticDelivery.result,
    })
    return response
  } catch (error) {
    const response = recommendationError(error)
    observeRecommendationDelivery({
      endpoint: "seeded",
      trafficCategory,
      persistenceDisposition: "not_observed",
      httpStatus: response.status,
      error,
    })
    return response
  }
}

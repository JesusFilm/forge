import { observeRecommendationDelivery } from "@/lib/recommendation-delivery-observability"
import { NextRequest } from "next/server"
import { env } from "@/env"
import {
  classifyRecommendationTraffic,
  recommendationTrafficExcluded,
  recommendationDeliveryDisposition,
} from "@/lib/recommendation-human-admission"
import { z } from "zod"
import { tryAsContentSlug, WATCH_CANONICAL_ORIGIN } from "@/lib/routes"
import {
  getSemanticRecommendationDelivery,
  getPrivateSemanticRecommendationFallback,
  getPrecomputedWatchPreviewDelivery,
  getPrivatePrecomputedWatchVisitDelivery,
  getPrecomputedWatchPublicVisitDelivery,
  RecommendationPreviewAuthorizationError,
} from "@/lib/recommendations"
import {
  readRecommendationTesterCookie,
  RECOMMENDATION_TESTER_COOKIE,
  RECOMMENDATION_EXPERIMENT_TESTER_COOKIE,
  readRecommendationExperimentTesterCookie,
} from "@/lib/recommendation-tester-token"
import {
  attachRecommendationExperimentBrowser,
  createRecommendationExperimentBrowser,
  readRecommendationExperimentBrowser,
} from "@/lib/recommendation-experiment-browser"
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
const DELIVERY_TOTAL_UPSTREAM_BUDGET_MS = 3_500
const PREVIEW_UPSTREAM_BUDGET_MS = 1_600

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
    const upstreamDeadlineAt = Date.now() + DELIVERY_TOTAL_UPSTREAM_BUDGET_MS
    const previewCookie = new NextRequest(request.url, {
      headers: request.headers,
    }).cookies.get(RECOMMENDATION_TESTER_COOKIE)?.value
    const previewCredential = await readRecommendationTesterCookie(
      previewCookie,
      {
        secret: env.WATCH_RECOMMENDATION_TESTER_SECRET,
        origin: env.NEXT_PUBLIC_CANONICAL_ORIGIN,
      },
    )
    const previewTester =
      env.WATCH_PRECOMPUTED_RECOMMENDATIONS_PREVIEW_ENABLED === "true" &&
      !excluded &&
      previewCredential
    const privateVisitHeader = request.headers.get(
      "x-forge-recommendation-visit-id",
    )
    const privateVisitId =
      privateVisitHeader &&
      z.string().uuid().safeParse(privateVisitHeader).success
        ? privateVisitHeader
        : null
    const visitInput = privateVisitId
      ? {
          visitId: privateVisitId,
          consentReceiptDigest,
          profileTokenDigest:
            consentReceiptDigest != null && profile?.kind === "valid"
              ? profile.digest
              : null,
          ...semanticInput,
          sessionDigest: session?.digest ?? "0".repeat(64),
          trafficCategory,
          clientDeliveryContract:
            request.headers.get("x-forge-recommendation-delivery-contract") ===
            COWATCH_MMR_CLIENT_DELIVERY_CONTRACT
              ? COWATCH_MMR_CLIENT_DELIVERY_CONTRACT
              : null,
        }
      : null
    const privateTesterCookie = new NextRequest(request.url, {
      headers: request.headers,
    }).cookies.get(RECOMMENDATION_EXPERIMENT_TESTER_COOKIE)?.value
    const privateTester =
      env.WATCH_PRECOMPUTED_RECOMMENDATIONS_TEST_ENABLED === "true" &&
      !previewCredential &&
      (await readRecommendationExperimentTesterCookie(privateTesterCookie, {
        secret: env.WATCH_RECOMMENDATION_TESTER_SECRET,
        origin: env.NEXT_PUBLIC_CANONICAL_ORIGIN,
      }))
    const privateBrowser = privateTester
      ? (readRecommendationExperimentBrowser(
          request,
          env.WATCH_RECOMMENDATION_TESTER_SECRET,
        ) ??
        createRecommendationExperimentBrowser(
          env.WATCH_RECOMMENDATION_TESTER_SECRET ?? "",
          privateTesterCookie,
        ))
      : null
    let privateVisit: Awaited<
      ReturnType<typeof getPrivatePrecomputedWatchVisitDelivery>
    > | null = null
    if (privateTester && privateBrowser && visitInput) {
      try {
        privateVisit = await getPrivatePrecomputedWatchVisitDelivery(
          {
            ...visitInput,
            browserDigest: privateBrowser.digest,
          },
          Math.max(1, upstreamDeadlineAt - Date.now()),
        )
      } catch {
        upstreamAcknowledged = false
      }
    }
    const publicBrowser =
      !previewCredential &&
      !privateTester &&
      trafficCategory === "ordinary_browser" &&
      privateVisitId
        ? (readRecommendationExperimentBrowser(
            request,
            env.WATCH_RECOMMENDATION_TESTER_SECRET,
          ) ??
          createRecommendationExperimentBrowser(
            env.WATCH_RECOMMENDATION_TESTER_SECRET ?? "",
          ))
        : null
    let publicVisit: Awaited<
      ReturnType<typeof getPrecomputedWatchPublicVisitDelivery>
    > | null = null
    if (publicBrowser && visitInput) {
      try {
        publicVisit = await getPrecomputedWatchPublicVisitDelivery(
          {
            ...visitInput,
            browserDigest: publicBrowser.digest,
          },
          Math.max(1, upstreamDeadlineAt - Date.now()),
        )
      } catch {
        upstreamAcknowledged = false
      }
    }
    let previewDelivery: Awaited<
      ReturnType<typeof getPrecomputedWatchPreviewDelivery>
    > | null = null
    let previewFailureReason: string | null = null
    let previewDenied = false
    if (previewTester) {
      try {
        previewDelivery = await getPrecomputedWatchPreviewDelivery(
          {
            ...semanticInput,
            sessionDigest: session!.digest,
          },
          Math.max(
            1,
            Math.min(
              PREVIEW_UPSTREAM_BUDGET_MS,
              upstreamDeadlineAt - Date.now(),
            ),
          ),
        )
        if (previewDelivery.result === "unavailable")
          previewFailureReason =
            previewDelivery.reason || "precomputed_unavailable"
      } catch (error) {
        previewDenied = error instanceof RecommendationPreviewAuthorizationError
        previewFailureReason = previewDenied
          ? "preview_authorization_denied"
          : "precomputed_upstream_unavailable"
        upstreamAcknowledged = false
      }
    }
    const sourceDenied =
      previewDelivery?.reason === "source_unavailable" ||
      previewDelivery?.reason === "source_eligibility_unavailable"
    const privateEligible = privateVisit?.status === "eligible"
    const publicEligible = publicVisit?.status === "eligible"
    const mayUseIncumbent =
      !privateEligible &&
      !publicEligible &&
      !publicVisit?.delivery &&
      (!previewTester ||
        (!previewDenied &&
          !sourceDenied &&
          previewDelivery?.result === "unavailable") ||
        (!previewDenied && !sourceDenied && !previewDelivery))
    const incumbentAttempted =
      mayUseIncumbent && Date.now() < upstreamDeadlineAt
    if (mayUseIncumbent && !incumbentAttempted) upstreamAcknowledged = false
    const visitDelivery = privateEligible
      ? (privateVisit!.delivery ?? unavailableSemanticDelivery())
      : publicEligible
        ? (publicVisit!.delivery ?? unavailableSemanticDelivery())
        : (publicVisit?.delivery ?? null)
    const semanticDelivery = incumbentAttempted
      ? await (
          previewCredential || privateTester
            ? getPrivateSemanticRecommendationFallback(
                {
                  ...semanticInput,
                  sessionDigest: session?.digest ?? "0".repeat(64),
                },
                Math.max(1, upstreamDeadlineAt - Date.now()),
              )
            : getSemanticRecommendationDelivery(
                {
                  ...semanticInput,
                  sessionDigest: session?.digest ?? "0".repeat(64),
                  consentReceiptDigest,
                  profileTokenDigest:
                    consentReceiptDigest != null && profile?.kind === "valid"
                      ? profile.digest
                      : null,
                  eligibleHuman: !excluded,
                  clientDeliveryContract:
                    request.headers.get(
                      "x-forge-recommendation-delivery-contract",
                    ) === COWATCH_MMR_CLIENT_DELIVERY_CONTRACT
                      ? COWATCH_MMR_CLIENT_DELIVERY_CONTRACT
                      : null,
                  trafficCategory,
                },
                Math.max(1, upstreamDeadlineAt - Date.now()),
              )
        ).catch(() => {
          upstreamAcknowledged = false
          return unavailableSemanticDelivery()
        })
      : (visitDelivery ??
        (previewDelivery
          ? { ...previewDelivery, personalization: null }
          : { ...unavailableSemanticDelivery(), reason: previewFailureReason }))
    // Admin owns exact-audio and published-presentation eligibility. Legacy
    // scene and collection APIs cannot attest those facts, so their cards
    // must not replace an empty or unavailable delivery.
    const admittedDelivery =
      deliveryDisposition === "deferred"
        ? { ...unavailableSemanticDelivery(), reason: "traffic_deferred" }
        : semanticDelivery
    const delivery = {
      ...admittedDelivery,
      ...(previewTester
        ? {
            previewAttribution: {
              assignedStrategy: "precomputed-watch-preview-v1",
              actualStrategy: incumbentAttempted
                ? admittedDelivery.result === "unavailable"
                  ? null
                  : admittedDelivery.strategyVersion
                : admittedDelivery.result === "unavailable"
                  ? null
                  : "precomputed-watch-preview-v1",
              generationId: previewDelivery?.generationId ?? null,
              reason: mayUseIncumbent
                ? admittedDelivery.reason === "source_unavailable" ||
                  admittedDelivery.reason === "source_eligibility_unavailable"
                  ? admittedDelivery.reason
                  : previewFailureReason
                : admittedDelivery.reason,
              assignedReason: previewFailureReason,
              actualReason: admittedDelivery.reason,
            },
          }
        : {}),
      ...(privateVisit
        ? {
            experimentAttribution: {
              visitId: privateVisit.visitId,
              experimentId: privateVisit.experimentId,
              generationId: privateVisit.generationId,
              assignedArm: privateVisit.arm,
              status: privateVisit.status,
              measurementStatus: privateVisit.measurementStatus,
              reason: privateVisit.reason,
              qualification: privateVisit.qualification,
            },
          }
        : {}),
      ...(publicVisit && publicVisit.disposition !== "inactive"
        ? {
            experimentAttribution: {
              visitId: publicVisit.visitId,
              experimentId: publicVisit.experimentId,
              generationId: publicVisit.generationId,
              assignedArm: publicVisit.arm,
              status: publicVisit.status,
              measurementStatus: publicVisit.measurementStatus,
              reason: publicVisit.reason,
              qualification: publicVisit.qualification,
            },
          }
        : {}),
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
    if (
      privateTester &&
      privateBrowser &&
      privateVisit?.status === "eligible" &&
      !readRecommendationExperimentBrowser(
        request,
        env.WATCH_RECOMMENDATION_TESTER_SECRET,
      )
    ) {
      attachRecommendationExperimentBrowser(response, privateBrowser)
    }
    if (
      publicBrowser &&
      publicVisit?.disposition === "ab" &&
      publicVisit.status === "eligible"
    ) {
      // Reissue the same signed identity so an existing cookie cannot expire
      // before the frozen experiment finishes and change its assignment.
      attachRecommendationExperimentBrowser(response, publicBrowser)
    }
    let experimentAdmission:
      | "missing_visit_id"
      | "browser_identity_unavailable"
      | "visit_identity_conflict"
      | "public_delivery_unavailable"
      | undefined
    if (publicVisit?.reason === "visit_identity_conflict") {
      experimentAdmission = "visit_identity_conflict"
    } else if (publicVisit?.reason === "visit_persistence_unavailable") {
      experimentAdmission = "public_delivery_unavailable"
    } else if (
      !previewCredential &&
      !privateTester &&
      trafficCategory === "ordinary_browser"
    ) {
      if (!privateVisitId) experimentAdmission = "missing_visit_id"
      else if (!publicBrowser)
        experimentAdmission = "browser_identity_unavailable"
      else if (!publicVisit) experimentAdmission = "public_delivery_unavailable"
    }
    observeRecommendationDelivery({
      endpoint: "seeded",
      trafficCategory,
      experimentAdmission,
      persistenceDisposition: !upstreamAcknowledged
        ? "not_observed"
        : excluded
          ? semanticDelivery.requestId
            ? "unexpected_commit"
            : "avoided"
          : publicVisit?.measurementStatus === "recorded"
            ? "committed"
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

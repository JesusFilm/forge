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
  attachWatchHumanBrowserGrant,
  createWatchHumanBrowserGrant,
  createWatchHumanVerificationReceipt,
  readWatchHumanBrowserGrant,
} from "@/lib/recommendation-human-proof"
import {
  isLoopbackWatchHost,
  isWatchTurnstileTestCredential,
  verifyWatchRecommendationTurnstile,
  WATCH_RECOMMENDATION_TURNSTILE_FIXTURE_HOSTNAME,
  WATCH_RECOMMENDATION_TURNSTILE_TEST_SECRET_KEY,
  WATCH_RECOMMENDATION_TURNSTILE_TEST_SITE_KEY,
} from "@/lib/recommendation-turnstile"
import {
  recordWatchExperimentObservation,
  recordWatchPublicObservation,
  watchPublicObservationHour,
  type WatchPublicObservation,
} from "@/lib/recommendation-public-observation"
import { issueWatchExperimentMeasurementTicket } from "@/lib/recommendation-experiment-measurement-ticket"
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
    turnstileToken: z.string().min(1).max(2_048).optional(),
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
  const observationHour = watchPublicObservationHour()
  const liveObservationEnabled =
    (env.WATCH_RECOMMENDATION_HUMAN_PROOF_SECRET?.length ?? 0) >= 32
  const attemptObserved = liveObservationEnabled
    ? await recordWatchPublicObservation("delivery_attempt", observationHour)
    : null
  let scopedExperimentId: string | null = null
  let scopedAttemptObserved = false
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
    const proofSecret = env.WATCH_RECOMMENDATION_HUMAN_PROOF_SECRET
    const allowedTurnstileHostnames = (
      env.WATCH_RECOMMENDATION_TURNSTILE_HOSTNAMES ?? ""
    )
      .split(",")
      .map((hostname) => hostname.trim())
      .filter(Boolean)
    const turnstileSiteKey =
      env.NEXT_PUBLIC_WATCH_RECOMMENDATION_TURNSTILE_SITE_KEY
    const turnstileSecret = env.WATCH_RECOMMENDATION_TURNSTILE_SECRET_KEY
    const testCredentials = isWatchTurnstileTestCredential(
      turnstileSiteKey,
      turnstileSecret,
    )
    const localFixtureConfigured =
      env.WATCH_RECOMMENDATION_TURNSTILE_TEST_FIXTURE_ENABLED === "1" &&
      process.env.NODE_ENV !== "production" &&
      isLoopbackWatchHost(new URL(request.url).hostname) &&
      turnstileSiteKey === WATCH_RECOMMENDATION_TURNSTILE_TEST_SITE_KEY &&
      turnstileSecret === WATCH_RECOMMENDATION_TURNSTILE_TEST_SECRET_KEY &&
      allowedTurnstileHostnames.includes(
        WATCH_RECOMMENDATION_TURNSTILE_FIXTURE_HOSTNAME,
      )
    const proofConfigured =
      !!proofSecret &&
      proofSecret.length >= 32 &&
      !!turnstileSecret &&
      !!turnstileSiteKey &&
      allowedTurnstileHostnames.length > 0 &&
      (!testCredentials || localFixtureConfigured) &&
      attemptObserved === true
    let verifiedBrowserGrant: {
      hostname: string
      issuedAt: number
      expiresAt: number
    } | null =
      publicBrowser && proofConfigured
        ? readWatchHumanBrowserGrant(
            request,
            publicBrowser.digest,
            proofSecret,
            allowedTurnstileHostnames,
          )
        : null
    let newBrowserGrantValue: string | null = null
    let turnstileStatus:
      | "not_requested"
      | "verified"
      | "fixture_verified"
      | "rejected"
      | "unavailable" = "not_requested"
    if (
      publicBrowser &&
      proofConfigured &&
      !verifiedBrowserGrant &&
      parsed.data.turnstileToken
    ) {
      const verification = await verifyWatchRecommendationTurnstile(
        parsed.data.turnstileToken,
        {
          secret: turnstileSecret,
          hostnames: allowedTurnstileHostnames,
          siteKey: turnstileSiteKey,
          allowLocalFixture: localFixtureConfigured,
          requestHostname: new URL(request.url).hostname,
        },
      )
      turnstileStatus = verification.status
      if (
        (verification.status === "verified" ||
          verification.status === "fixture_verified") &&
        proofSecret
      ) {
        const nowSeconds = Math.floor(Date.now() / 1_000)
        newBrowserGrantValue = createWatchHumanBrowserGrant(
          publicBrowser.digest,
          verification.hostname,
          proofSecret,
          nowSeconds,
        )
        if (newBrowserGrantValue) {
          verifiedBrowserGrant = {
            hostname: verification.hostname,
            issuedAt: nowSeconds,
            expiresAt: nowSeconds + 300,
          }
        }
      }
    }
    const humanVerificationReceipt =
      publicBrowser && privateVisitId && verifiedBrowserGrant && proofSecret
        ? createWatchHumanVerificationReceipt(
            {
              visitId: privateVisitId,
              browserDigest: publicBrowser.digest,
              seedMediaId: parsed.data.seedMediaId,
              locale: parsed.data.locale,
              audioLanguageSlug: parsed.data.audioLanguageSlug,
            },
            verifiedBrowserGrant,
            proofSecret,
          )
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
            humanVerificationReceipt,
          },
          Math.max(1, upstreamDeadlineAt - Date.now()),
        )
      } catch {
        upstreamAcknowledged = false
      }
    }
    if (
      attemptObserved &&
      publicVisit?.disposition === "ab" &&
      publicVisit.experimentId
    ) {
      scopedExperimentId = publicVisit.experimentId
      scopedAttemptObserved = await recordWatchExperimentObservation(
        scopedExperimentId,
        "delivery_attempt",
        observationHour,
      )
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
    const publicEligible =
      publicVisit?.status === "eligible" &&
      publicVisit.measurementStatus === "recorded"
    const publicDelivery =
      publicVisit?.disposition === "inactive" ||
      publicVisit?.disposition === "promoted" ||
      publicVisit?.reason === "visit_identity_conflict" ||
      publicEligible
        ? (publicVisit?.delivery ?? null)
        : null
    const mayUseIncumbent =
      !privateEligible &&
      !publicEligible &&
      !publicDelivery &&
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
        ? (publicDelivery ?? unavailableSemanticDelivery())
        : publicDelivery
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
      ...(publicEligible &&
      publicVisit?.disposition === "ab" &&
      publicVisit.experimentId &&
      admittedDelivery.requestId &&
      admittedDelivery.items.length > 0
        ? {
            measurementTicket: issueWatchExperimentMeasurementTicket(
              env.WATCH_RECOMMENDATION_TESTER_SECRET,
              {
                experimentId: publicVisit.experimentId,
                requestId: admittedDelivery.requestId,
              },
            ),
          }
        : {}),
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
    const verificationRequired =
      publicVisit?.reason === "verification_required" &&
      !verifiedBrowserGrant &&
      proofConfigured
    const serialized = JSON.stringify({
      delivery,
      deliveryDisposition,
      ...(verificationRequired
        ? {
            verificationRequired: true,
            verificationSiteKey:
              env.NEXT_PUBLIC_WATCH_RECOMMENDATION_TURNSTILE_SITE_KEY,
          }
        : {}),
    })
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
      (((publicVisit?.disposition === "ab" ||
        publicVisit?.disposition === "baseline") &&
        (publicVisit.status === "eligible" || verificationRequired)) ||
        newBrowserGrantValue)
    ) {
      // Reissue the same signed identity so an existing cookie cannot expire
      // before the frozen experiment finishes and change its assignment.
      attachRecommendationExperimentBrowser(response, publicBrowser)
    }
    if (newBrowserGrantValue) {
      attachWatchHumanBrowserGrant(response, newBrowserGrantValue)
    }
    let experimentAdmission:
      | "missing_visit_id"
      | "browser_identity_unavailable"
      | "visit_identity_conflict"
      | "public_delivery_unavailable"
      | "verification_required"
      | undefined
    if (publicVisit?.reason === "visit_identity_conflict") {
      experimentAdmission = "visit_identity_conflict"
    } else if (publicVisit?.reason === "visit_persistence_unavailable") {
      experimentAdmission = "public_delivery_unavailable"
    } else if (publicVisit?.reason === "verification_required") {
      experimentAdmission = "verification_required"
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
    let outcomeObserved = false
    if (attemptObserved) {
      let terminal: WatchPublicObservation
      if (excluded) terminal = "delivery_excluded"
      else if (trafficCategory !== "ordinary_browser")
        terminal = "delivery_unknown"
      else if (previewCredential || privateTester) terminal = "delivery_private"
      else if (!privateVisitId || !publicBrowser)
        terminal = "delivery_missing_identity"
      else if (turnstileStatus === "rejected")
        terminal = "delivery_verification_rejected"
      else if (turnstileStatus === "unavailable")
        terminal = "delivery_verification_unavailable"
      else if (publicVisit?.reason === "verification_required")
        terminal = "delivery_verification_required"
      else if (publicVisit?.disposition === "inactive")
        terminal = "delivery_inactive"
      else if (
        publicVisit?.status === "eligible" &&
        publicVisit.measurementStatus === "recorded"
      )
        terminal = "delivery_qualified"
      else if (
        !publicVisit ||
        publicVisit.status === "unavailable" ||
        publicVisit.measurementStatus === "unavailable"
      )
        terminal = "delivery_unavailable"
      else terminal = "delivery_rejected"
      outcomeObserved = await recordWatchPublicObservation(
        terminal,
        observationHour,
      )
    }
    if (scopedAttemptObserved && scopedExperimentId)
      await recordWatchExperimentObservation(
        scopedExperimentId,
        publicEligible ? "delivery_eligible" : "delivery_not_eligible",
        observationHour,
      )
    observeRecommendationDelivery({
      endpoint: "seeded",
      trafficCategory,
      experimentAdmission,
      experimentObservation:
        attemptObserved === null
          ? undefined
          : !attemptObserved
            ? "unavailable"
            : outcomeObserved
              ? "committed"
              : "partial",
      turnstileStatus:
        turnstileStatus === "not_requested" ? undefined : turnstileStatus,
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
    if (scopedAttemptObserved && scopedExperimentId)
      await recordWatchExperimentObservation(
        scopedExperimentId,
        "delivery_response_failed",
        observationHour,
      )
    const outcomeObserved = attemptObserved
      ? await recordWatchPublicObservation("delivery_rejected", observationHour)
      : false
    observeRecommendationDelivery({
      endpoint: "seeded",
      trafficCategory,
      experimentObservation:
        attemptObserved === null
          ? undefined
          : !attemptObserved
            ? "unavailable"
            : outcomeObserved
              ? "committed"
              : "partial",
      persistenceDisposition: "not_observed",
      httpStatus: response.status,
      error,
    })
    return response
  }
}

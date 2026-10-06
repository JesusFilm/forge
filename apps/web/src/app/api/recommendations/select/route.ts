import { observeEvidenceResponse } from "@/lib/recommendation-evidence-response"
import { assertRecommendationHumanAdmission } from "@/lib/recommendation-human-admission"
import { NextRequest } from "next/server"
import { env } from "@/env"
import { z } from "zod"
import {
  isCanonicalWatchRecommendationHref,
  WATCH_CANONICAL_ORIGIN,
} from "@/lib/routes"
import {
  selectPrivatePrecomputedRecommendation,
  selectSemanticRecommendation,
} from "@/lib/recommendations"
import { readRecommendationExperimentBrowser } from "@/lib/recommendation-experiment-browser"
import {
  readRecommendationExperimentTesterCookie,
  RECOMMENDATION_EXPERIMENT_TESTER_COOKIE,
} from "@/lib/recommendation-tester-token"
import {
  RECOMMENDATION_EVIDENCE_BODY_BYTES,
  RecommendationRouteError,
  readStrictRecommendationJson,
} from "@/lib/recommendation-route-policy"
import {
  recommendationError,
  recommendationJson,
} from "@/lib/recommendation-route-response"
import {
  digestRecommendationValue,
  readRecommendationSession,
} from "@/lib/recommendation-session"
import { RECOMMENDATION_EVIDENCE_CONTRACT } from "@/lib/recommendation-contracts"
import {
  recordWatchPublicObservation,
  watchPublicObservationHour,
} from "@/lib/recommendation-public-observation"

export const dynamic = "force-dynamic"
export const revalidate = 0

const SelectionInput = z
  .object({
    contractVersion: z.literal(RECOMMENDATION_EVIDENCE_CONTRACT),
    capability: z.string().min(1).max(4096),
    requestId: z.string().min(1).max(191),
    itemId: z.string().min(1).max(191),
    eventId: z.string().min(1).max(191),
    occurredAt: z.string().datetime({ offset: true }),
    tabNonce: z.string().min(1).max(191),
    claimNonce: z.string().min(16).max(191),
  })
  .strict()

export async function POST(request: Request) {
  const observationHour = watchPublicObservationHour()
  const observationAttempt =
    (env.WATCH_RECOMMENDATION_HUMAN_PROOF_SECRET?.length ?? 0) >= 32
      ? recordWatchPublicObservation("click_attempt", observationHour)
      : Promise.resolve(false)
  try {
    assertRecommendationHumanAdmission(request)
    const raw = await readStrictRecommendationJson(request, {
      expectedOrigin: WATCH_CANONICAL_ORIGIN,
      maxBytes: RECOMMENDATION_EVIDENCE_BODY_BYTES,
    })
    const parsed = SelectionInput.safeParse(raw)
    if (!parsed.success) {
      throw new RecommendationRouteError(400, "invalid_body")
    }
    const session = readRecommendationSession(request)
    if (!session) {
      throw new RecommendationRouteError(401, "recommendation_session_required")
    }
    const selectionInput = {
      contractVersion: parsed.data.contractVersion,
      capability: parsed.data.capability,
      requestId: parsed.data.requestId,
      itemId: parsed.data.itemId,
      eventId: parsed.data.eventId,
      occurredAt: parsed.data.occurredAt,
      sessionDigest: session.digest,
      tabDigest: digestRecommendationValue(parsed.data.tabNonce),
      claimNonce: parsed.data.claimNonce,
    }
    const privateTesterCookie = new NextRequest(request.url, {
      headers: request.headers,
    }).cookies.get(RECOMMENDATION_EXPERIMENT_TESTER_COOKIE)?.value
    const privateTester =
      env.WATCH_PRECOMPUTED_RECOMMENDATIONS_TEST_ENABLED === "true" &&
      (await readRecommendationExperimentTesterCookie(privateTesterCookie, {
        secret: env.WATCH_RECOMMENDATION_TESTER_SECRET,
        origin: env.NEXT_PUBLIC_CANONICAL_ORIGIN,
      }))
    // A card issued before rollback still belongs to its persisted visit.
    // Bind by the signed browser cookie rather than the current serving mode.
    const experimentBrowser = readRecommendationExperimentBrowser(
      request,
      env.WATCH_RECOMMENDATION_TESTER_SECRET,
    )
    const selection =
      privateTester || experimentBrowser
        ? await selectPrivatePrecomputedRecommendation({
            ...selectionInput,
            browserDigest: experimentBrowser?.digest ?? null,
          })
        : await selectSemanticRecommendation(selectionInput)
    if (
      (selection.status !== "accepted" && selection.status !== "replay") ||
      !selection.claimNonce
    ) {
      throw new RecommendationRouteError(409, "selection_unavailable")
    }
    if (
      selection.claimNonce.length < 16 ||
      selection.claimNonce.length > 191 ||
      selection.claimNonce !== parsed.data.claimNonce ||
      !selection.targetMediaId ||
      selection.targetMediaId.length > 191 ||
      !isCanonicalWatchRecommendationHref(selection.canonicalHref)
    ) {
      throw new RecommendationRouteError(502, "invalid_admin_response")
    }
    observeEvidenceResponse(request, "select", 200, undefined, [selection])
    if (await observationAttempt)
      await recordWatchPublicObservation("click_ack", observationHour)
    return recommendationJson({
      claimNonce: selection.claimNonce,
      canonicalHref: selection.canonicalHref,
      targetMediaId: selection.targetMediaId,
    })
  } catch (error) {
    const response = recommendationError(error)
    if (await observationAttempt)
      await recordWatchPublicObservation("click_unavailable", observationHour)
    observeEvidenceResponse(request, "select", response.status, error)
    return response
  }
}

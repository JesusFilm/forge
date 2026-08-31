import { z } from "zod"
import {
  isCanonicalWatchRecommendationHref,
  WATCH_CANONICAL_ORIGIN,
} from "@/lib/routes"
import { selectSemanticRecommendation } from "@/lib/recommendations"
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
  })
  .strict()

export async function POST(request: Request) {
  try {
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
    const selection = await selectSemanticRecommendation({
      contractVersion: parsed.data.contractVersion,
      capability: parsed.data.capability,
      requestId: parsed.data.requestId,
      itemId: parsed.data.itemId,
      eventId: parsed.data.eventId,
      occurredAt: parsed.data.occurredAt,
      sessionDigest: session.digest,
      tabDigest: digestRecommendationValue(parsed.data.tabNonce),
    })
    if (selection.status !== "accepted" || !selection.claimNonce) {
      throw new RecommendationRouteError(409, "selection_unavailable")
    }
    if (
      selection.claimNonce.length < 16 ||
      selection.claimNonce.length > 191 ||
      !selection.targetMediaId ||
      selection.targetMediaId.length > 191 ||
      !isCanonicalWatchRecommendationHref(selection.canonicalHref)
    ) {
      throw new RecommendationRouteError(502, "invalid_admin_response")
    }
    return recommendationJson({
      claimNonce: selection.claimNonce,
      canonicalHref: selection.canonicalHref,
      targetMediaId: selection.targetMediaId,
    })
  } catch (error) {
    return recommendationError(error)
  }
}

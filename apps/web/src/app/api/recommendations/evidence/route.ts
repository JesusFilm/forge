import { z } from "zod"
import { WATCH_CANONICAL_ORIGIN } from "@/lib/routes"
import { recordSemanticRecommendationEvidence } from "@/lib/recommendations"
import {
  RECOMMENDATION_EVIDENCE_BODY_BYTES,
  RecommendationRouteError,
  readStrictRecommendationJson,
} from "@/lib/recommendation-route-policy"
import {
  recommendationError,
  recommendationJson,
} from "@/lib/recommendation-route-response"
import { readRecommendationSession } from "@/lib/recommendation-session"
import { RECOMMENDATION_EVIDENCE_CONTRACT } from "@/lib/recommendation-contracts"

export const dynamic = "force-dynamic"
export const revalidate = 0

const EvidenceInput = z
  .object({
    contractVersion: z.literal(RECOMMENDATION_EVIDENCE_CONTRACT),
    capability: z.string().min(1).max(4096),
    requestId: z.string().min(1).max(191),
    itemId: z.string().min(1).max(191),
    events: z
      .array(
        z
          .object({
            eventId: z.string().min(1).max(191),
            kind: z.enum(["render", "impression"]),
            occurredAt: z.string().datetime({ offset: true }),
            payload: z.record(z.string(), z.unknown()),
          })
          .strict(),
      )
      .min(1)
      .max(16),
  })
  .strict()

export async function POST(request: Request) {
  try {
    const raw = await readStrictRecommendationJson(request, {
      expectedOrigin: WATCH_CANONICAL_ORIGIN,
      maxBytes: RECOMMENDATION_EVIDENCE_BODY_BYTES,
    })
    const parsed = EvidenceInput.safeParse(raw)
    if (!parsed.success) {
      throw new RecommendationRouteError(400, "invalid_body")
    }
    const session = readRecommendationSession(request)
    if (!session) {
      throw new RecommendationRouteError(401, "recommendation_session_required")
    }
    const receipts = await recordSemanticRecommendationEvidence({
      ...parsed.data,
      sessionDigest: session.digest,
    })
    return recommendationJson({ receipts })
  } catch (error) {
    return recommendationError(error)
  }
}

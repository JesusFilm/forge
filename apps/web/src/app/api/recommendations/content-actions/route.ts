import { z } from "zod"
import { recordRecommendationContentAction } from "@/lib/recommendations"
import {
  RECOMMENDATION_CONTENT_ACTION_BODY_BYTES,
  RECOMMENDATION_CONTENT_ACTION_CONTRACT,
} from "@/lib/recommendation-contracts"
import {
  RecommendationRouteError,
  readStrictRecommendationJson,
} from "@/lib/recommendation-route-policy"
import { assertRecommendationMutationAdmission } from "@/lib/recommendation-mutation-admission"
import {
  recommendationError,
  recommendationJson,
} from "@/lib/recommendation-route-response"
import {
  attachRecommendationSession,
  ensureRecommendationSession,
} from "@/lib/recommendation-session"
import { WATCH_CANONICAL_ORIGIN } from "@/lib/routes"

export const dynamic = "force-dynamic"
export const revalidate = 0

const Input = z
  .object({
    contractVersion: z.literal(RECOMMENDATION_CONTENT_ACTION_CONTRACT),
    eventId: z.string().min(1).max(191),
    occurredAt: z.string().datetime({ offset: true }),
    mediaId: z.string().min(1).max(191),
    actionKind: z.enum(["share", "save", "course_add", "continuation"]),
    actionDetail: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
      .nullable()
      .optional(),
  })
  .strict()

export async function POST(request: Request) {
  try {
    const raw = await readStrictRecommendationJson(request, {
      expectedOrigin: WATCH_CANONICAL_ORIGIN,
      maxBytes: RECOMMENDATION_CONTENT_ACTION_BODY_BYTES,
    })
    const parsed = Input.safeParse(raw)
    if (!parsed.success) {
      throw new RecommendationRouteError(400, "invalid_body")
    }
    await assertRecommendationMutationAdmission(
      request.headers,
      "content-action",
    )
    const session = ensureRecommendationSession(request)
    const receipt = await recordRecommendationContentAction({
      ...parsed.data,
      actionDetail: parsed.data.actionDetail ?? null,
      sessionDigest: session.digest,
    })
    const response = recommendationJson({ receipt })
    attachRecommendationSession(response, session)
    return response
  } catch (error) {
    return recommendationError(error)
  }
}

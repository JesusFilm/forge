import { z } from "zod"
import { assertRecommendationHumanAdmission } from "@/lib/recommendation-human-admission"
import { assertRecommendationMutationAdmission } from "@/lib/recommendation-mutation-admission"
import {
  RecommendationRouteError,
  readStrictRecommendationJson,
} from "@/lib/recommendation-route-policy"
import {
  recommendationError,
  recommendationJson,
} from "@/lib/recommendation-route-response"
import { recordWatchSurfaceExposure } from "@/lib/recommendations"
import { WATCH_CANONICAL_ORIGIN } from "@/lib/routes"

export const dynamic = "force-dynamic"
export const revalidate = 0

const Event = z
  .object({
    eventId: z.string().uuid(),
    windowId: z.string().uuid(),
    surface: z.enum([
      "watch-home",
      "watch-search",
      "watch-video",
      "watch-series",
    ]),
    block: z.enum([
      "hero",
      "collections",
      "authored",
      "results",
      "editorial",
      "chapters",
      "episodes",
    ]),
    presentation: z.enum([
      "hero-card",
      "carousel",
      "grid",
      "result-list",
      "authored-block",
      "episode-grid",
    ]),
    placement: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    policyVersion: z.literal("watch-exposure-v1"),
    position: z.number().int().min(0).max(99),
    itemPath: z
      .string()
      .max(512)
      .regex(/^\/watch\/[a-zA-Z0-9_-]+\.html(?:\/[a-zA-Z0-9_-]+\.html){0,2}$/),
    kind: z.enum(["rendered", "eligible", "selected"]),
    visibilityCapability: z.enum(["unknown", "occlusion-aware"]).nullable(),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict()

export async function POST(request: Request) {
  try {
    assertRecommendationHumanAdmission(request)
    const raw = await readStrictRecommendationJson(request, {
      expectedOrigin: WATCH_CANONICAL_ORIGIN,
      maxBytes: 48 * 1024,
    })
    const events = z.array(Event).min(1).max(64).safeParse(raw)
    if (!events.success) throw new RecommendationRouteError(400, "invalid_body")
    await assertRecommendationMutationAdmission(
      request.headers,
      "surface-exposure",
    )
    const receipts = await recordWatchSurfaceExposure(events.data)
    return recommendationJson({ receipts })
  } catch (error) {
    return recommendationError(error)
  }
}

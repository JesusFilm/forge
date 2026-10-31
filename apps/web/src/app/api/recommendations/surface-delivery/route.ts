import { z } from "zod"
import {
  assertRecommendationHumanAdmission,
  classifyRecommendationTraffic,
} from "@/lib/recommendation-human-admission"
import { assertRecommendationMutationAdmission } from "@/lib/recommendation-mutation-admission"
import {
  RecommendationRouteError,
  readStrictRecommendationJson,
} from "@/lib/recommendation-route-policy"
import {
  recommendationError,
  recommendationJson,
} from "@/lib/recommendation-route-response"
import { issueWatchSurfaceDelivery } from "@/lib/recommendations"
import { WATCH_CANONICAL_ORIGIN } from "@/lib/routes"
import { verifyWatchSurfaceManifest } from "@/lib/watch-surface-manifest.server"

export const dynamic = "force-dynamic"
export const revalidate = 0

const Input = z
  .object({
    descriptor: z.unknown(),
    attemptId: z.string().uuid(),
  })
  .strict()

export async function POST(request: Request) {
  try {
    assertRecommendationHumanAdmission(request)
    const raw = await readStrictRecommendationJson(request, {
      expectedOrigin: WATCH_CANONICAL_ORIGIN,
      maxBytes: 64 * 1024,
    })
    const parsed = Input.safeParse(raw)
    if (!parsed.success) throw new RecommendationRouteError(400, "invalid_body")
    const manifest = verifyWatchSurfaceManifest(parsed.data.descriptor)
    if (!manifest) throw new RecommendationRouteError(400, "invalid_manifest")
    // Share the existing bounded exposure bucket: issuance never creates viewer
    // or profile state and is not a new unbounded admission namespace.
    await assertRecommendationMutationAdmission(
      request.headers,
      "surface-exposure",
    )
    const receipt = await issueWatchSurfaceDelivery({
      manifest,
      attemptId: parsed.data.attemptId,
      trafficCategory: classifyRecommendationTraffic(request),
    })
    return recommendationJson(receipt)
  } catch (error) {
    return recommendationError(error)
  }
}

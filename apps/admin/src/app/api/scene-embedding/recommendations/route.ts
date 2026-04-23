/**
 * GET /api/scene-embedding/recommendations — public scene-similarity
 * recommendations endpoint.
 *
 * Byte-compatible with apps/cms
 * `/api/scene-embedding/recommendations` (singular path, matching cms's
 * actual route). apps/web's renderer will swap base URL at R8 cutover
 * with zero response-shape drift (modulo the one-line `videoId: number
 * → string` type update covered by the plan).
 *
 * See docs/plans/2026-04-23-003-feat-admin-r5-recommendations-plan.md Unit 4.
 */

import { prisma } from "@/db/client"
import { rateLimitAuthRoute } from "@/auth/rate-limit"
import {
  SceneRecommendationsService,
  VideoNotFoundError,
} from "@/services/scene-recommendations.service"

const RATE_LIMIT_MAX = 30
const RATE_LIMIT_WINDOW_MS = 60_000

function badRequest(error: string): Response {
  return Response.json({ error }, { status: 400 })
}

function tooManyRequests(): Response {
  return Response.json({ error: "Too many requests" }, { status: 429 })
}

function parseNumericParam(raw: string | null): number | undefined {
  if (raw == null || raw.length === 0) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

export async function GET(request: Request): Promise<Response> {
  const limit = await rateLimitAuthRoute({
    request,
    route: "recommendations",
    limit: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  })
  if (!limit.allowed) return tooManyRequests()

  const { searchParams } = new URL(request.url)

  const videoId = searchParams.get("videoId")?.trim()
  const slug = searchParams.get("slug")?.trim()
  if (!videoId && !slug) {
    return badRequest("videoId or slug is required")
  }

  const locale = searchParams.get("locale")?.trim()
  if (!locale) {
    return badRequest("locale is required")
  }

  const sceneIndexRaw = searchParams.get("sceneIndex")
  let sceneIndex: number | undefined
  if (sceneIndexRaw != null && sceneIndexRaw.length > 0) {
    const parsed = Number(sceneIndexRaw)
    if (!Number.isFinite(parsed)) {
      return badRequest("sceneIndex must be a number")
    }
    sceneIndex = parsed
  }

  const limitParam = parseNumericParam(searchParams.get("limit"))

  try {
    const service = new SceneRecommendationsService({ prisma })
    const recommendations = await service.getRecommendations({
      videoId: videoId || undefined,
      slug: slug || undefined,
      locale,
      sceneIndex,
      limit: limitParam,
    })
    return Response.json({ recommendations }, { status: 200 })
  } catch (error) {
    if (error instanceof VideoNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 })
    }
    console.error(
      `[scene-embedding] Recommendations failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return Response.json(
      { error: "Scene recommendation features not available" },
      { status: 503 },
    )
  }
}

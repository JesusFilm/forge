/**
 * GET /api/search — public hybrid search endpoint.
 *
 * Matches the shape of apps/cms `/api/search` so apps/web + apps/mobile
 * can swap base URL at R8 cutover with zero response-shape drift.
 * See docs/plans/2026-04-23-002-feat-admin-r4-hybrid-search-plan.md Unit 6.
 */

import { prisma } from "@/db/client"
import { rateLimitAuthRoute } from "@/auth/rate-limit"
import {
  HybridSearchService,
  isContentType,
  type ContentType,
} from "@/services/hybrid-search.service"

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
    route: "search",
    limit: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  })
  if (!limit.allowed) return tooManyRequests()

  const { searchParams } = new URL(request.url)

  const q = searchParams.get("q")?.trim() ?? ""
  if (q.length === 0) {
    return badRequest("q (search query) is required")
  }

  const locale = searchParams.get("locale")
  if (!locale || locale.length === 0) {
    return badRequest("locale is required")
  }

  const rawType = searchParams.get("type")
  let contentTypes: ContentType[] | undefined
  if (rawType != null && rawType.length > 0) {
    if (!isContentType(rawType)) {
      return badRequest("type must be 'video' or 'experience'")
    }
    contentTypes = [rawType]
  }

  const limitParam = parseNumericParam(searchParams.get("limit"))
  const offsetParam = parseNumericParam(searchParams.get("offset"))

  try {
    const service = new HybridSearchService({ prisma })
    const result = await service.search({
      query: q,
      locale,
      limit: limitParam,
      offset: offsetParam,
      contentTypes,
    })
    return Response.json(result, { status: 200 })
  } catch (error) {
    console.error(
      `[search] Search failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return Response.json(
      { error: "Search is temporarily unavailable" },
      { status: 503 },
    )
  }
}

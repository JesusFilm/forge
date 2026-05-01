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
import { isDebugAllowedForOrigin } from "@/services/hybrid-search-debug-allowlist"

const RATE_LIMIT_MAX = 30
const RATE_LIMIT_WINDOW_MS = 60_000

/**
 * Hard upper bound on the trimmed `q` parameter length. Above this the
 * request is rejected at the boundary instead of being passed through to
 * `websearch_to_tsquery` / `similarity()` (the keyword-first retrievers)
 * or to the embedding provider (semantic). 1024 chars is well above any
 * natural-language search query (the longest known song title is ~70
 * characters; a paragraph is ~500) and well below the regimes where the
 * Postgres tsquery parser starts spending meaningful CPU. The matching
 * per-token cap (`MAX_EXACT_TITLE_TOKENS = 16`) lives inside
 * `searchByExactTitle`; the length cap covers the other two retrievers
 * + the embedding provider input.
 */
const MAX_QUERY_LENGTH = 1024

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
  if (q.length > MAX_QUERY_LENGTH) {
    return badRequest(`q must be at most ${MAX_QUERY_LENGTH} characters`)
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

  // `mode` is a free-form string at the boundary so future modes can
  // ship without REST schema changes. The service's `normalizeMode`
  // warn-and-falls-back on unknown values; we forward the empty string
  // as undefined so logs aren't polluted on bare `?mode=`.
  const rawMode = searchParams.get("mode")
  const mode = rawMode != null && rawMode.length > 0 ? rawMode : undefined

  // `debug=true` opts into the per-result internal scoring payload.
  // Origin-gated at the boundary (the service trusts the boolean):
  // a curl-from-prod with no `Origin` header is fail-closed; a
  // browser request from a non-allowlisted origin is also rejected.
  // Any other truthy value (e.g. `?debug=1`) is intentionally treated
  // as "off" — debug is a deliberate developer affordance, not a
  // pattern-matching toggle.
  const debugRequested = searchParams.get("debug") === "true"
  const origin = request.headers.get("origin") ?? undefined
  const debug = debugRequested && isDebugAllowedForOrigin(origin)

  try {
    const service = new HybridSearchService({ prisma })
    const result = await service.search({
      query: q,
      locale,
      limit: limitParam,
      offset: offsetParam,
      contentTypes,
      mode,
      debug,
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

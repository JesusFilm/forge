/**
 * GET /api/search — public hybrid search endpoint.
 *
 * Matches the shape of apps/cms `/api/search` so apps/web + apps/mobile
 * can swap base URL at R8 cutover with zero response-shape drift.
 * See docs/plans/2026-04-23-002-feat-admin-r4-hybrid-search-plan.md Unit 6.
 */

import { prisma } from "@/db/client"
import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { isAnyKnownBearer } from "@/auth/search-bearer"
import { env } from "@/config/env"
import {
  HybridSearchService,
  isContentType,
  type ContentType,
} from "@/services/hybrid-search.service"
import { isDebugAllowedForOrigin } from "@/services/hybrid-search-debug-allowlist"
import { recordSearchTraceSafely } from "@/services/search-trace.service"

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

function authenticationRequired(
  authTag: "invalid_bearer" | "anonymous",
): Response {
  // RFC 6750 §3 — the WWW-Authenticate header on a 401 surfaces the
  // realm + a machine-discriminable error code so debugging partners
  // can distinguish "I sent a bad key" from "I sent no key at all"
  // without having to inspect admin's logs. Emitted on every 401:
  //   invalid_bearer → error="invalid_token"
  //   anonymous      → no error code (per RFC 6750 §3.1, omit when
  //                    no credentials were sent)
  const challenge =
    authTag === "invalid_bearer"
      ? 'Bearer realm="search", error="invalid_token"'
      : 'Bearer realm="search"'
  return Response.json(
    { error: "Authentication required" },
    {
      status: 401,
      headers: { "WWW-Authenticate": challenge },
    },
  )
}

function parseNumericParam(raw: string | null): number | undefined {
  if (raw == null || raw.length === 0) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

export async function GET(request: Request): Promise<Response> {
  // Rate-limit applies to EVERY request — anonymous, valid bearer,
  // invalid bearer alike — bucketed per source IP at RATE_LIMIT_MAX/
  // min. Running rate-limit BEFORE the auth check prevents an
  // attacker from spamming junk Authorization headers to bypass the
  // bucket and amplify load on the bearer compare. Trade-off: a
  // legitimate authed caller whose source IP is shared with an
  // abuser shares the bucket, but that's already true for any per-
  // IP scheme — the bearer is a passport (identity), not a budget
  // (per-key quota).
  const limit = await rateLimitAuthRoute({
    request,
    route: "search",
    limit: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  })
  if (!limit.allowed) return tooManyRequests()

  // Phase-1 dual-accept auth gate. After the SEARCH_AUTH_REQUIRED
  // flip, anonymous + invalid-bearer traffic 401s.
  //
  // The structured log tags every request with one of three states
  // so operators can identify un-migrated callers BEFORE flipping
  // the gate (a caller presenting a stale or wrong key shows up as
  // `invalid_bearer`, distinct from a caller who sent no header at
  // all — the latter is expected during dual-accept; the former is
  // the population that will 401 after the flip). The `rl` field
  // tags whether the rate-limit decision came from Redis or the
  // in-process fallback — `rl=local` on a high-traffic prod replica
  // signals Redis degradation.
  //
  // The auth check accepts ANY of three known-caller bearer sources
  // (DB-backed partner / consumer / workflow) — see `isAnyKnownBearer`
  // in `auth/search-bearer.ts`. apps/web SSR + apps/mobile (which
  // already carry the consumer-bearer for graphql) need no code
  // change; external partners hold a DB-backed key issued via
  // `pnpm --filter @forge/admin partner-keys create`.
  const authHeader = request.headers.get("authorization")
  const authResult = await isAnyKnownBearer(authHeader)
  const authTag: "bearer" | "invalid_bearer" | "anonymous" = authResult.valid
    ? "bearer"
    : authHeader != null
      ? "invalid_bearer"
      : "anonymous"
  // Emit in the `[search] event=... key=value` key=value string
  // format used by the existing working logs in this surface (e.g.,
  // `event=query_embedding_failure` in hybrid-search.service.ts).
  // Empirically, on the current Next.js 16 + Node 24 + Railway
  // logsV2 + standalone stack, JSON-stringified payloads
  // (`console.error(JSON.stringify({...}))`) are silenced — verified
  // wrong by PR #970 (console.warn-JSON) and PR #972
  // (console.error-JSON). Only `[label] event=name key=value` string
  // lines surface in Railway's deploymentLogs query. PR #973 corrects
  // to the working format. Operators grep for `event=search.request`
  // and parse key=value pairs the same way they do for the
  // embedding-failure event today.
  //
  // `source=<branch>` distinguishes which bearer source matched
  // (partner / consumer / workflow). `keyId=<id>` is appended only on
  // PARTNER matches — env-CSV branches don't carry a per-key
  // identifier so the field is omitted to keep parsing simple
  // (operators check for `keyId=` presence to scope to per-partner
  // queries).
  //
  // Field ordering: stable positional fields (`event`, `auth`, `path`,
  // `rl`) come FIRST and never shift; optional fields (`source`,
  // `keyId`) are appended at the END so any positional log-shipper
  // rule that targets the stable fields is unaffected.
  const sourceField = authResult.valid ? ` source=${authResult.source}` : ""
  const keyIdField =
    authResult.valid && authResult.keyId ? ` keyId=${authResult.keyId}` : ""
  console.error(
    `[search] event=search.request auth=${authTag} path=rest rl=${limit.source}${sourceField}${keyIdField}`,
  )
  if (!authResult.valid && env.SEARCH_AUTH_REQUIRED === "true") {
    // authTag here is "invalid_bearer" or "anonymous" (the `bearer`
    // case satisfies authResult.valid). TS narrows after the guard.
    return authenticationRequired(authTag as "invalid_bearer" | "anonymous")
  }

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
  const startedAt = new Date()

  try {
    const service = new HybridSearchService({ prisma })
    const { response, trace } = await service.searchWithTrace({
      query: q,
      locale,
      limit: limitParam,
      offset: offsetParam,
      contentTypes,
      mode,
      debug,
    })
    await recordSearchTraceSafely({
      query: q,
      locale,
      routeSource: "rest",
      requestedMode: mode ?? null,
      searchMode: trace.searchMode,
      resultCount: trace.resultCount,
      outcome: trace.outcome,
      traceClass: trace.traceClass,
      startedAt,
      completedAt: new Date(),
    }).catch(() => {})
    return Response.json(response, { status: 200 })
  } catch (error) {
    await recordSearchTraceSafely({
      query: q,
      locale,
      routeSource: "rest",
      requestedMode: mode ?? null,
      searchMode: "failed",
      resultCount: 0,
      outcome: "failed",
      traceClass: "search_exception",
      startedAt,
      completedAt: new Date(),
    }).catch(() => {})
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

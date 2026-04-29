import type { Core } from "@strapi/strapi"
import { embedQuery } from "../../../lib/openrouter"
import { isDebugAllowedForOrigin } from "../services/debug-allowlist"
import {
  getStats,
  recordAttempt,
  recordFailure,
  withTimeout,
} from "../services/search-health"
import { search, isContentType, type ContentType } from "../services/search"

type StrapiContext = {
  status: number
  body: unknown
  request: {
    query?: Record<string, string | undefined>
    headers?: Record<string, string | undefined>
  }
}

/**
 * Synthetic probe ceiling. OpenRouter's configured client timeout is 10s
 * (see lib/openrouter.ts); we use a shorter probe window so a stalled
 * request fails fast and external monitors can page quickly.
 */
const HEALTH_PROBE_TIMEOUT_MS = 5_000

/** Fixed input for the health probe. Kept constant so embedding cost and
 *  cache behaviour are predictable, and so logs stay unambiguous. */
const HEALTH_PROBE_INPUT = "health probe"

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async search(ctx: StrapiContext) {
    const query = ctx.request.query ?? {}

    const q = query.q
    if (!q || q.trim().length === 0) {
      ctx.status = 400
      ctx.body = { error: "q (search query) is required" }
      return
    }

    const locale = query.locale
    if (!locale) {
      ctx.status = 400
      ctx.body = { error: "locale is required" }
      return
    }

    // Optional type filter — restricts results to the given content type.
    // Omitting it returns both videos and experiences (the default).
    let contentTypes: ContentType[] | undefined
    const rawType = query.type
    if (rawType != null && rawType.length > 0) {
      if (!isContentType(rawType)) {
        ctx.status = 400
        ctx.body = { error: "type must be 'video' or 'experience'" }
        return
      }
      contentTypes = [rawType]
    }

    const limit = query.limit ? Number(query.limit) || undefined : undefined
    const offset = query.offset ? Number(query.offset) || undefined : undefined

    // Optional retrieval mode (feat-109). Forwarded as-is to the service;
    // unknown values warn-and-fall-back to "hybrid" inside `search()`.
    // An explicit empty string is treated as omitted so callers building
    // URLs with optional query params don't get spurious behavior.
    const rawMode = query.mode
    const mode = rawMode != null && rawMode.length > 0 ? rawMode : undefined

    // Optional `debug=true` flag (feat-109). Origin-gated at the
    // boundary — the service trusts the boolean we pass it. Fail-closed
    // behavior on undefined origins lives in `isDebugAllowedForOrigin`.
    const debugRequested = query.debug === "true"
    const origin = ctx.request.headers?.origin
    const debug = debugRequested && isDebugAllowedForOrigin(origin)

    try {
      const result = await search(strapi, {
        query: q.trim(),
        locale,
        limit,
        offset,
        contentTypes,
        mode,
        debug,
      })
      ctx.status = 200
      ctx.body = result
    } catch (error) {
      strapi.log.error(
        `[search] Search failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      ctx.status = 503
      ctx.body = { error: "Search is temporarily unavailable" }
    }
  },

  /**
   * GET /api/search/health
   *
   * Synthetic reachability probe for the OpenRouter query-embedding path.
   * Runs a single `embedQuery` call with a short timeout and returns the
   * outcome plus the process-local attempts/failures counters that the
   * search service also updates.
   *
   * Always returns HTTP 200 — the JSON body's `status` field is the
   * machine-readable signal (`ok` or `degraded`). Returning 200 even on
   * failure matches how Railway healthchecks and most uptime monitors
   * interpret responses: they read the body rather than treating the
   * HTTP status as the primary signal, and we don't want to confuse
   * infrastructure-level liveness ("is the CMS process up?") with
   * third-party reachability ("is OpenRouter responding?").
   *
   * Counters are shared with the search service so operators see a
   * single unified view of all embedding-call activity on the process.
   */
  async health(ctx: StrapiContext & { set?: (h: string, v: string) => void }) {
    recordAttempt()
    try {
      await withTimeout(embedQuery(HEALTH_PROBE_INPUT), HEALTH_PROBE_TIMEOUT_MS)
      ctx.status = 200
      ctx.body = { status: "ok", error: null, ...getStats() }
    } catch (error) {
      recordFailure(error)
      const errorClass =
        error instanceof Error ? error.constructor.name : "UnknownError"
      const message = error instanceof Error ? error.message : String(error)
      strapi.log.error(
        `[search] event=health_probe_failed error_class=${errorClass} message=${message}`,
      )
      ctx.status = 200
      ctx.body = { status: "degraded", error: message, ...getStats() }
    }
  },
})

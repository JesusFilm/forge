import type { Core } from "@strapi/strapi"
import {
  SEARCH_RATE_LIMIT,
  checkRateLimit,
  resolveClientIp,
} from "../lib/rate-limit-bucket"

/**
 * Per-IP fixed-window rate limiter.
 *
 * Protects public endpoints that drive external API cost (e.g., the search
 * endpoint calling OpenRouter for every request). Cloudflare WAF handles
 * infrastructure-level throttling; this middleware provides application-level
 * defense-in-depth so the endpoint stays protected even if WAF rules drift.
 *
 * Shares buckets with the GraphQL resolver (via lib/rate-limit-bucket) so
 * an attacker can't bypass the limit by alternating REST and GraphQL.
 *
 * Usage in route config:
 *   config: {
 *     auth: false,
 *     middlewares: [
 *       { name: "global::rate-limit", config: { key: "search" } },
 *     ],
 *   }
 *
 * When `max` / `windowMs` are omitted, defaults come from
 * SEARCH_RATE_LIMIT — keep them in sync by importing from the same module.
 */

type RateLimitConfig = {
  /** Max requests per window per IP. Default from SEARCH_RATE_LIMIT.max. */
  max?: number
  /** Window size in milliseconds. Default from SEARCH_RATE_LIMIT.windowMs. */
  windowMs?: number
  /** Bucket key prefix to isolate this endpoint's limits from others. */
  key?: string
}

export default (
  config: RateLimitConfig,
  { strapi }: { strapi: Core.Strapi },
) => {
  const max = config.max ?? SEARCH_RATE_LIMIT.max
  const windowMs = config.windowMs ?? SEARCH_RATE_LIMIT.windowMs
  const keyPrefix = config.key ?? "default"

  return async (
    ctx: {
      request: { headers: Record<string, string | undefined>; ip?: string }
      ip?: string
      status: number
      body: unknown
      set: (header: string, value: string) => void
    },
    next: () => Promise<void>,
  ) => {
    const ip = resolveClientIp(ctx.request.headers, ctx.ip ?? ctx.request.ip)
    const result = checkRateLimit(`${keyPrefix}:${ip}`, max, windowMs)

    // Explicit === false narrows the discriminated union so TypeScript
    // allows .retryAfterSeconds access in the false branch.
    if (result.allowed === false) {
      ctx.status = 429
      ctx.set("Retry-After", String(result.retryAfterSeconds))
      ctx.body = { error: "Too many requests. Please try again later." }
      strapi.log.warn(
        `[rate-limit] ${ip} exceeded limit (${max}/${windowMs}ms)`,
      )
      return
    }

    await next()
  }
}

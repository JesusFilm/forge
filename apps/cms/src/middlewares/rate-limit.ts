import type { Core } from "@strapi/strapi"
import { checkRateLimit } from "../lib/rate-limit-bucket"

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
 *       { name: "global::rate-limit", config: { max: 30, windowMs: 60000 } },
 *     ],
 *   }
 */

type RateLimitConfig = {
  /** Max requests per window per IP. Default 30. */
  max?: number
  /** Window size in milliseconds. Default 60_000 (1 minute). */
  windowMs?: number
  /** Optional prefix to isolate buckets per endpoint. */
  key?: string
}

function getClientIp(ctx: {
  request: { headers: Record<string, string | undefined>; ip?: string }
  ip?: string
}): string {
  const forwarded = ctx.request.headers["x-forwarded-for"]
  if (forwarded) {
    // x-forwarded-for can be a comma-separated list; first entry is the client
    return forwarded.split(",")[0].trim()
  }
  return ctx.ip ?? ctx.request.ip ?? "unknown"
}

export default (
  config: RateLimitConfig,
  { strapi }: { strapi: Core.Strapi },
) => {
  const max = config.max ?? 30
  const windowMs = config.windowMs ?? 60_000
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
    const ip = getClientIp(ctx)
    const result = checkRateLimit(`${keyPrefix}:${ip}`, max, windowMs)

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

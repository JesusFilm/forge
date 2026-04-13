/**
 * Shared per-key fixed-window rate limit bucket.
 *
 * Used by both the REST middleware (global::rate-limit) and the GraphQL
 * resolver for semanticSearch. Both entry points share one Map so an
 * attacker can't bypass the limit by mixing REST and GraphQL calls.
 *
 * This is a single-process limiter. Swap for a Redis-backed store if
 * the CMS ever scales horizontally.
 */

/**
 * Search-endpoint rate limit. Single source of truth shared by the REST
 * route config, the rate-limit middleware defaults, and the GraphQL
 * resolver so the three can never drift.
 */
export const SEARCH_RATE_LIMIT = {
  max: 30,
  windowMs: 60_000,
  /** Shared bucket prefix — must match across REST and GraphQL to
   *  prevent protocol-alternation bypass. */
  key: "search",
} as const

type Bucket = {
  count: number
  resetAt: number
}

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number }

const buckets = new Map<string, Bucket>()

/** Every N calls, sweep expired entries to prevent unbounded Map growth
 *  from rotating-IP attacks. Cheaper than a setInterval (no timer
 *  lifecycle to manage) and bounded by traffic volume. */
const SWEEP_EVERY_N_CALLS = 1000
let callsSinceSweep = 0

function sweepExpiredBuckets(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

/**
 * Checks and increments the bucket for `key`. Returns whether the request
 * is allowed. If not, returns how many seconds until the window resets.
 */
export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  callsSinceSweep += 1
  if (callsSinceSweep >= SWEEP_EVERY_N_CALLS) {
    sweepExpiredBuckets(now)
    callsSinceSweep = 0
  }

  const existing = buckets.get(key)

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true }
  }

  if (existing.count >= max) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((existing.resetAt - now) / 1000),
    )
    return { allowed: false, retryAfterSeconds }
  }

  existing.count += 1
  return { allowed: true }
}

/**
 * Extracts the trusted client IP from a request's headers.
 *
 * Preference order (most trusted first):
 *   1. `cf-connecting-ip` — set by Cloudflare with the real client IP.
 *      Cannot be spoofed by the client because Cloudflare overwrites it.
 *   2. First entry of `x-forwarded-for` — standard proxy header. The
 *      leftmost value is attacker-controllable if the request bypasses
 *      Cloudflare, so this is the fallback, not the primary.
 *   3. The provided fallback (e.g., `ctx.ip`).
 *   4. "unknown" — should only happen in test/dev.
 */
export function resolveClientIp(
  headers: Record<string, string | undefined>,
  fallback: string | undefined,
): string {
  // Trim first, then check length — a whitespace-only header would
  // otherwise pass the length check and collapse to "" after trim,
  // giving all such requests a shared empty-IP bucket.
  const cloudflareIp = headers["cf-connecting-ip"]?.trim()
  if (cloudflareIp && cloudflareIp.length > 0) {
    return cloudflareIp
  }
  const forwarded = headers["x-forwarded-for"]
  if (forwarded && forwarded.length > 0) {
    const firstEntry = forwarded.split(",")[0].trim()
    if (firstEntry.length > 0) return firstEntry
  }
  return fallback ?? "unknown"
}

/** Test hook — clears all buckets. Not for production use. */
export function __resetRateLimitBuckets(): void {
  buckets.clear()
  callsSinceSweep = 0
}

/** Test hook — returns the current number of tracked buckets. */
export function __getRateLimitBucketSize(): number {
  return buckets.size
}

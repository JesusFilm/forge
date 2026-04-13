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

type Bucket = {
  count: number
  resetAt: number
}

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number }

const buckets = new Map<string, Bucket>()

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

/** Test hook — clears all buckets. Not for production use. */
export function __resetRateLimitBuckets(): void {
  buckets.clear()
}

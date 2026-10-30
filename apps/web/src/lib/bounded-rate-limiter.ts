import "server-only"

export type BoundedRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number }

type Bucket = { windowStart: number; count: number }

/**
 * Per-process fixed-window limiter with a hard memory bound.
 *
 * - Expiry: a key's bucket dies `windowMs` after its first hit. Buckets are
 *   kept in window-start order (a reset re-inserts at the end), so the expired
 *   ones are always a prefix and each admit sweeps only that prefix.
 * - Hard cap: at most `maxKeys` buckets exist. A new key arriving at the cap is
 *   NOT allowed to evict a tracked key (that would let a flood of fresh keys
 *   reset an abuser's bucket); it shares one overflow bucket with its own
 *   `overflowLimit`, so a distributed flood degrades new visitors, never memory
 *   or an existing client's limit.
 *
 * Replicas keep separate state, so the effective ceiling is per replica.
 */
export function createBoundedRateLimiter(options: {
  limit: number
  windowMs: number
  maxKeys: number
  overflowLimit: number
  now?: () => number
}) {
  const { limit, windowMs, maxKeys, overflowLimit } = options
  // Read the clock per call so fake timers and injected clocks both apply.
  const now = options.now ?? (() => Date.now())
  const buckets = new Map<string, Bucket>()
  const overflow: Bucket = { windowStart: 0, count: 0 }

  function sweep(at: number): void {
    for (const [key, bucket] of buckets) {
      if (at - bucket.windowStart < windowMs) break
      buckets.delete(key)
    }
  }

  function take(
    bucket: Bucket,
    max: number,
    at: number,
  ): BoundedRateLimitResult {
    if (bucket.count === 0 || at - bucket.windowStart >= windowMs) {
      bucket.windowStart = at
      bucket.count = 0
    }
    if (bucket.count >= max) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((bucket.windowStart + windowMs - at) / 1000),
        ),
      }
    }
    bucket.count += 1
    return { allowed: true }
  }

  return {
    admit(key: string): BoundedRateLimitResult {
      const at = now()
      sweep(at)
      const tracked = buckets.get(key)
      if (tracked) return take(tracked, limit, at)
      if (buckets.size >= maxKeys) return take(overflow, overflowLimit, at)
      const fresh: Bucket = { windowStart: at, count: 0 }
      buckets.set(key, fresh)
      return take(fresh, limit, at)
    },
    /** Tracked keys only (the overflow bucket is a single fixed slot). */
    size: () => buckets.size,
  }
}

/**
 * Client identity for per-client admission. Production Watch sits behind
 * Cloudflare, so only `cf-connecting-ip` is trusted: `x-forwarded-for` is
 * client-suppliable and would let a caller mint a fresh bucket per request.
 * A missing, empty or oversized identity collapses into one bounded `unknown`
 * bucket instead of bypassing admission (same rule as
 * `recommendation-mutation-admission.ts`).
 */
export function trustedClientKey(headers: Pick<Headers, "get">): string {
  const address = headers.get("cf-connecting-ip")?.trim()
  return address && address.length <= 128 ? address : "unknown"
}

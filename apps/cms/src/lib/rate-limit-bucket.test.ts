import { beforeEach, describe, expect, it } from "vitest"
import {
  __getRateLimitBucketSize,
  __resetRateLimitBuckets,
  checkRateLimit,
  resolveClientIp,
  SEARCH_RATE_LIMIT,
} from "./rate-limit-bucket"

beforeEach(() => {
  __resetRateLimitBuckets()
})

describe("checkRateLimit", () => {
  it("allows the first request in a new window", () => {
    const result = checkRateLimit("ip-1", 3, 60_000, 1_000)
    expect(result).toEqual({ allowed: true })
  })

  it("allows requests up to max within the window", () => {
    const now = 1_000
    expect(checkRateLimit("ip-1", 3, 60_000, now)).toEqual({ allowed: true })
    expect(checkRateLimit("ip-1", 3, 60_000, now)).toEqual({ allowed: true })
    expect(checkRateLimit("ip-1", 3, 60_000, now)).toEqual({ allowed: true })
  })

  it("rejects the request that exceeds max with retryAfter in seconds", () => {
    const now = 1_000
    checkRateLimit("ip-1", 2, 60_000, now)
    checkRateLimit("ip-1", 2, 60_000, now)
    const result = checkRateLimit("ip-1", 2, 60_000, now)

    expect(result).toEqual({ allowed: false, retryAfterSeconds: 60 })
  })

  it("starts a new window after the previous one expires", () => {
    const windowStart = 1_000
    const windowMs = 60_000

    checkRateLimit("ip-1", 1, windowMs, windowStart)
    const rejectedInWindow = checkRateLimit("ip-1", 1, windowMs, windowStart)
    expect(rejectedInWindow.allowed).toBe(false)

    // After window resets
    const afterReset = checkRateLimit(
      "ip-1",
      1,
      windowMs,
      windowStart + windowMs + 1,
    )
    expect(afterReset.allowed).toBe(true)
  })

  it("tracks buckets per key independently", () => {
    const now = 1_000
    checkRateLimit("ip-1", 1, 60_000, now)
    // ip-2 gets its own bucket
    expect(checkRateLimit("ip-2", 1, 60_000, now)).toEqual({ allowed: true })
    // ip-1 is already at limit
    expect(checkRateLimit("ip-1", 1, 60_000, now).allowed).toBe(false)
  })

  it("rounds retryAfterSeconds up to at least 1", () => {
    const now = 1_000
    checkRateLimit("ip-1", 1, 100, now)
    // Only 50ms remaining in the window
    const result = checkRateLimit("ip-1", 1, 100, now + 50)
    expect(result).toEqual({ allowed: false, retryAfterSeconds: 1 })
  })
})

describe("SEARCH_RATE_LIMIT constants", () => {
  it("exports a 'search' key used by both REST and GraphQL", () => {
    expect(SEARCH_RATE_LIMIT.key).toBe("search")
    expect(SEARCH_RATE_LIMIT.max).toBeGreaterThan(0)
    expect(SEARCH_RATE_LIMIT.windowMs).toBeGreaterThan(0)
  })
})

describe("resolveClientIp", () => {
  it("prefers cf-connecting-ip over x-forwarded-for", () => {
    const ip = resolveClientIp(
      {
        "cf-connecting-ip": "1.2.3.4",
        "x-forwarded-for": "5.6.7.8",
      },
      "fallback.ip",
    )
    expect(ip).toBe("1.2.3.4")
  })

  it("uses first entry of x-forwarded-for when cf-connecting-ip is absent", () => {
    const ip = resolveClientIp(
      { "x-forwarded-for": "203.0.113.5, 10.0.0.1, 10.0.0.2" },
      "fallback.ip",
    )
    expect(ip).toBe("203.0.113.5")
  })

  it("trims whitespace from x-forwarded-for entries", () => {
    const ip = resolveClientIp(
      { "x-forwarded-for": "  203.0.113.5  , 10.0.0.1" },
      undefined,
    )
    expect(ip).toBe("203.0.113.5")
  })

  it("trims cf-connecting-ip", () => {
    const ip = resolveClientIp({ "cf-connecting-ip": "  9.9.9.9  " }, undefined)
    expect(ip).toBe("9.9.9.9")
  })

  it("falls back to the provided fallback when no headers present", () => {
    const ip = resolveClientIp({}, "10.0.0.50")
    expect(ip).toBe("10.0.0.50")
  })

  it("returns 'unknown' when no headers and no fallback", () => {
    const ip = resolveClientIp({}, undefined)
    expect(ip).toBe("unknown")
  })

  it("treats empty cf-connecting-ip as absent", () => {
    const ip = resolveClientIp(
      { "cf-connecting-ip": "", "x-forwarded-for": "1.1.1.1" },
      undefined,
    )
    expect(ip).toBe("1.1.1.1")
  })
})

describe("bucket sweep (memory leak prevention)", () => {
  it("evicts expired buckets after the sweep interval", () => {
    const now = 1_000
    const windowMs = 100

    // Create many entries that will all expire at the same time.
    // Each is a fresh key so they don't overwrite each other.
    for (let i = 0; i < 500; i++) {
      checkRateLimit(`expired-${i}`, 10, windowMs, now)
    }
    expect(__getRateLimitBucketSize()).toBe(500)

    // Advance past expiry. Make 500 calls with FRESH keys so total
    // callsSinceSweep reaches 1000, triggering the sweep.
    const afterExpiry = now + windowMs + 1
    for (let i = 0; i < 500; i++) {
      checkRateLimit(`fresh-${i}`, 10, windowMs, afterExpiry)
    }

    // On the 1000th call the sweep runs: all 500 expired entries are
    // deleted. The 500 fresh entries remain. Size should be ~500.
    expect(__getRateLimitBucketSize()).toBeLessThanOrEqual(500)
  })

  it("does not leak unbounded memory under rotating-IP attacks", () => {
    const windowMs = 100
    // Simulate 3000 requests from unique IPs, all expiring quickly.
    // Without the sweep, size would grow to 3000. With the sweep,
    // it stays bounded.
    for (let i = 0; i < 3000; i++) {
      const t = i * 10 // each request 10ms apart so earlier ones expire
      checkRateLimit(`attacker-${i}`, 10, windowMs, t)
    }
    // Should be well under 3000 because earlier entries got swept.
    expect(__getRateLimitBucketSize()).toBeLessThan(3000)
  })
})

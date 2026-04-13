import { beforeEach, describe, expect, it } from "vitest"
import { __resetRateLimitBuckets, checkRateLimit } from "./rate-limit-bucket"

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

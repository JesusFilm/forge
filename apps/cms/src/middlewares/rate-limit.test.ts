import { beforeEach, describe, expect, it, vi } from "vitest"
import { __resetRateLimitBuckets } from "../lib/rate-limit-bucket"
import rateLimitFactory from "./rate-limit"

type MockCtx = {
  request: { headers: Record<string, string | undefined>; ip?: string }
  ip?: string
  status: number
  body: unknown
  set: ReturnType<typeof vi.fn>
}

function makeCtx(overrides: Partial<MockCtx> = {}): MockCtx {
  return {
    request: { headers: {}, ...overrides.request },
    ip: overrides.ip,
    status: 0,
    body: undefined,
    set: vi.fn(),
    ...overrides,
  }
}

const mockStrapi = {
  log: { warn: vi.fn() },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

function buildMiddleware(
  config: { max?: number; windowMs?: number; key?: string } = {},
) {
  return rateLimitFactory(config, { strapi: mockStrapi })
}

beforeEach(() => {
  __resetRateLimitBuckets()
  vi.clearAllMocks()
})

describe("rate-limit middleware", () => {
  it("calls next() when under the limit", async () => {
    const mw = buildMiddleware({ max: 2, windowMs: 60_000, key: "test" })
    const ctx = makeCtx({
      request: { headers: { "cf-connecting-ip": "1.1.1.1" } },
    })
    const next = vi.fn().mockResolvedValue(undefined)

    await mw(ctx, next)

    expect(next).toHaveBeenCalledOnce()
    expect(ctx.status).toBe(0)
  })

  it("returns 429 with Retry-After header when limit exceeded", async () => {
    const mw = buildMiddleware({ max: 1, windowMs: 60_000, key: "test" })
    const ctx1 = makeCtx({
      request: { headers: { "cf-connecting-ip": "1.1.1.1" } },
    })
    const ctx2 = makeCtx({
      request: { headers: { "cf-connecting-ip": "1.1.1.1" } },
    })
    const next = vi.fn().mockResolvedValue(undefined)

    await mw(ctx1, next)
    await mw(ctx2, next)

    expect(ctx2.status).toBe(429)
    expect(ctx2.body).toEqual({
      error: "Too many requests. Please try again later.",
    })
    expect(ctx2.set).toHaveBeenCalledWith("Retry-After", expect.any(String))
    // next() was called exactly once (for the first request)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it("logs a warning when rate limit is exceeded", async () => {
    const mw = buildMiddleware({ max: 1, windowMs: 60_000, key: "test" })
    const ctx1 = makeCtx({
      request: { headers: { "cf-connecting-ip": "2.2.2.2" } },
    })
    const ctx2 = makeCtx({
      request: { headers: { "cf-connecting-ip": "2.2.2.2" } },
    })
    const next = vi.fn().mockResolvedValue(undefined)

    await mw(ctx1, next)
    await mw(ctx2, next)

    expect(mockStrapi.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("2.2.2.2"),
    )
  })

  it("prefers cf-connecting-ip over x-forwarded-for for bucketing", async () => {
    const mw = buildMiddleware({ max: 1, windowMs: 60_000, key: "test" })
    const next = vi.fn().mockResolvedValue(undefined)

    // First request from "real" client IP (Cloudflare says 3.3.3.3)
    const ctx1 = makeCtx({
      request: {
        headers: {
          "cf-connecting-ip": "3.3.3.3",
          "x-forwarded-for": "4.4.4.4",
        },
      },
    })
    await mw(ctx1, next)

    // Second request — attacker tries to spoof a different x-forwarded-for
    // but Cloudflare still reports the same real IP, so should be rate-limited
    const ctx2 = makeCtx({
      request: {
        headers: {
          "cf-connecting-ip": "3.3.3.3",
          "x-forwarded-for": "9.9.9.9",
        },
      },
    })
    await mw(ctx2, next)

    expect(ctx2.status).toBe(429)
  })

  it("falls back to x-forwarded-for when cf-connecting-ip is absent", async () => {
    const mw = buildMiddleware({ max: 1, windowMs: 60_000, key: "test" })
    const next = vi.fn().mockResolvedValue(undefined)

    const ctx1 = makeCtx({
      request: { headers: { "x-forwarded-for": "5.5.5.5, 10.0.0.1" } },
    })
    await mw(ctx1, next)

    // Same client (leftmost x-forwarded-for) should hit the same bucket
    const ctx2 = makeCtx({
      request: { headers: { "x-forwarded-for": "5.5.5.5, 10.0.0.2" } },
    })
    await mw(ctx2, next)

    expect(ctx2.status).toBe(429)
  })

  it("falls back to ctx.ip when no forwarded headers are present", async () => {
    const mw = buildMiddleware({ max: 1, windowMs: 60_000, key: "test" })
    const next = vi.fn().mockResolvedValue(undefined)

    const ctx1 = makeCtx({ ip: "6.6.6.6" })
    await mw(ctx1, next)
    const ctx2 = makeCtx({ ip: "6.6.6.6" })
    await mw(ctx2, next)

    expect(ctx2.status).toBe(429)
  })

  it("isolates buckets per key prefix", async () => {
    const mwSearch = buildMiddleware({
      max: 1,
      windowMs: 60_000,
      key: "search",
    })
    const mwOther = buildMiddleware({
      max: 1,
      windowMs: 60_000,
      key: "other",
    })
    const next = vi.fn().mockResolvedValue(undefined)

    // Same IP hits both endpoints — should NOT share the limit
    await mwSearch(
      makeCtx({ request: { headers: { "cf-connecting-ip": "7.7.7.7" } } }),
      next,
    )
    const otherCtx = makeCtx({
      request: { headers: { "cf-connecting-ip": "7.7.7.7" } },
    })
    await mwOther(otherCtx, next)

    expect(otherCtx.status).toBe(0) // allowed — different key prefix
  })

  it("uses SEARCH_RATE_LIMIT defaults when max/windowMs are omitted", async () => {
    const mw = buildMiddleware({ key: "search" })
    const next = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({
      request: { headers: { "cf-connecting-ip": "8.8.8.8" } },
    })

    await mw(ctx, next)

    expect(ctx.status).toBe(0)
    expect(next).toHaveBeenCalledOnce()
  })
})

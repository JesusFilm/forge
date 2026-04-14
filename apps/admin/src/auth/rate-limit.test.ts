import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("rateLimitAuthRoute", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    const { resetLocalRateLimitState } = await import("./rate-limit")
    resetLocalRateLimitState()
  })

  it("uses the local fallback when Redis env is absent", async () => {
    const { rateLimitAuthRoute } = await import("./rate-limit")
    const request = new Request("http://localhost/api/auth/sign-in/email")

    await expect(
      rateLimitAuthRoute({
        request,
        route: "sign-in/email",
        limit: 1,
        windowMs: 60_000,
      }),
    ).resolves.toEqual({ allowed: true, source: "local" })

    await expect(
      rateLimitAuthRoute({
        request,
        route: "sign-in/email",
        limit: 1,
        windowMs: 60_000,
      }),
    ).resolves.toEqual({ allowed: false, source: "local" })
  })

  it("falls back to local when Redis connect/incr fails", async () => {
    vi.stubEnv("REDIS_HOST", "127.0.0.1")
    vi.stubEnv("REDIS_PORT", "6379")
    vi.stubEnv("REDIS_PASSWORD", "secret")

    const { rateLimitAuthRoute } = await import("./rate-limit")
    const request = new Request("http://localhost/api/auth/sign-in/email")

    await expect(
      rateLimitAuthRoute({
        request,
        route: "sign-in/email",
        limit: 1,
        windowMs: 60_000,
      }),
    ).resolves.toEqual({ allowed: true, source: "local" })
  })
})

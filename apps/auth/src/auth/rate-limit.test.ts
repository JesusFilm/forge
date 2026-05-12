import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/infra/redis", () => ({
  getRedisClient: vi.fn(() => null),
}))

describe("rateLimitAuthRoute", () => {
  beforeEach(async () => {
    const { resetLocalRateLimitState } = await import("./rate-limit")
    resetLocalRateLimitState()
  })

  it("uses the local fallback when Redis is absent", async () => {
    const { rateLimitAuthRoute } = await import("./rate-limit")
    const request = new Request("http://localhost/api/auth/sign-in/email", {
      headers: { "x-forwarded-for": "127.0.0.1" },
    })

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
})

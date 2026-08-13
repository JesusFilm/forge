import { EventEmitter } from "node:events"

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
    ).resolves.toEqual({ allowed: true, source: "local", count: 1 })

    await expect(
      rateLimitAuthRoute({
        request,
        route: "sign-in/email",
        limit: 1,
        windowMs: 60_000,
      }),
    ).resolves.toEqual({ allowed: false, source: "local", count: 1 })
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
    ).resolves.toEqual({ allowed: true, source: "local", count: 1 })
  })
})

describe("incrementFixedWindow (local fallback)", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    const { resetLocalRateLimitState } = await import("./rate-limit")
    resetLocalRateLimitState()
  })

  it("counts up then blocks past the limit when Redis is absent", async () => {
    const { incrementFixedWindow } = await import("./rate-limit")

    for (const expected of [1, 2, 3]) {
      await expect(
        incrementFixedWindow("fleet-global:abc", 3, 60_000),
      ).resolves.toEqual({ allowed: true, source: "local", count: expected })
    }

    // 4th call: window already holds 3 attempts (= limit) → blocked, count stays 3.
    await expect(
      incrementFixedWindow("fleet-global:abc", 3, 60_000),
    ).resolves.toEqual({ allowed: false, source: "local", count: 3 })
  })
})

describe("incrementFixedWindow (redis path)", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(async () => {
    vi.doUnmock("@/infra/redis")
    vi.useRealTimers()
    const { resetLocalRateLimitState } = await import("./rate-limit")
    resetLocalRateLimitState()
    vi.restoreAllMocks()
  })

  it("returns source=redis with the INCR count from a live Redis eval", async () => {
    const evalMock = vi.fn().mockResolvedValue(7)
    vi.doMock("@/infra/redis", () => ({
      getRedisClient: () => ({ status: "ready", eval: evalMock }),
    }))
    const { incrementFixedWindow } = await import("./rate-limit")

    await expect(
      incrementFixedWindow("fleet-global:k", 10, 60_000),
    ).resolves.toEqual({ allowed: true, source: "redis", count: 7 })
    await expect(
      incrementFixedWindow("fleet-global:k", 5, 60_000),
    ).resolves.toEqual({ allowed: false, source: "redis", count: 7 })
  })

  it("waits for a connecting Redis client before evaluating the window", async () => {
    const client = Object.assign(new EventEmitter(), {
      status: "connecting",
      eval: vi.fn(async () => {
        if (client.status !== "ready") {
          throw new Error(
            "Stream isn't writeable and enableOfflineQueue options is false",
          )
        }
        return 1
      }),
    })
    vi.doMock("@/infra/redis", () => ({
      getRedisClient: () => client,
    }))
    const { incrementFixedWindow } = await import("./rate-limit")

    const first = incrementFixedWindow("candidate:first", 10, 60_000)
    const second = incrementFixedWindow("candidate:second", 10, 60_000)
    expect(client.listenerCount("ready")).toBe(1)
    client.status = "ready"
    client.emit("ready")

    await expect(Promise.all([first, second])).resolves.toEqual([
      { allowed: true, source: "redis", count: 1 },
      { allowed: true, source: "redis", count: 1 },
    ])
    expect(client.eval).toHaveBeenCalledTimes(2)
    expect(client.listenerCount("ready")).toBe(0)
    expect(client.listenerCount("close")).toBe(0)
    expect(client.listenerCount("end")).toBe(0)
  })

  it("shares one deadline between Redis readiness and command execution", async () => {
    vi.useFakeTimers()
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const client = Object.assign(new EventEmitter(), {
      status: "connecting",
      eval: vi.fn(() => new Promise(() => {})),
    })
    vi.doMock("@/infra/redis", () => ({
      getRedisClient: () => client,
    }))
    const { incrementFixedWindow } = await import("./rate-limit")

    const admission = incrementFixedWindow("candidate:deadline", 10, 60_000)
    await vi.advanceTimersByTimeAsync(200)
    expect(client.eval).not.toHaveBeenCalled()

    client.status = "ready"
    client.emit("ready")
    await vi.advanceTimersByTimeAsync(50)

    await expect(admission).resolves.toMatchObject({ source: "local" })
    expect(client.eval).toHaveBeenCalledOnce()
  })

  it("falls back to local with a plain-string warn on a redis command error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.doMock("@/infra/redis", () => ({
      getRedisClient: () => ({
        status: "ready",
        eval: vi.fn().mockRejectedValue(new Error("boom")),
      }),
    }))
    const { incrementFixedWindow } = await import("./rate-limit")

    const res = await incrementFixedWindow("search:1.2.3.4", 5, 60_000)
    expect(res.source).toBe("local")
    const line = warnSpy.mock.calls
      .map((a) => String(a[0]))
      .find((l) => l.includes("rate_limit.redis_unavailable"))
    expect(line).toBeDefined()
    // Plain-string (not JSON — Railway logsV2 rule), keyPrefix only (never the ip).
    expect(
      line!.startsWith("[ratelimit] event=rate_limit.redis_unavailable"),
    ).toBe(true)
    expect(line).toContain("keyPrefix=search")
    expect(line).not.toContain("1.2.3.4")
    expect(line!.startsWith("{")).toBe(false)
  })

  it("times out a slow redis command and falls back to local", async () => {
    vi.useFakeTimers()
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.doMock("@/infra/redis", () => ({
      getRedisClient: () => ({
        status: "ready",
        eval: () => new Promise(() => {}),
      }),
    }))
    const { incrementFixedWindow } = await import("./rate-limit")

    const pending = incrementFixedWindow("fleet-global:k", 5, 60_000)
    await vi.advanceTimersByTimeAsync(300)
    const res = await pending
    expect(res.source).toBe("local")
  })
})

import { afterEach, describe, expect, it, vi } from "vitest"

const redisMocks = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock("redis", () => ({ createClient: redisMocks.createClient }))

import {
  RECOMMENDATION_MUTATION_CLIENT_LIMIT,
  createRecommendationMutationAdmission,
  resetRecommendationMutationAdmissionForTests,
} from "./recommendation-mutation-admission"

function headers(address: string, cookie = "") {
  return new Headers({ "cf-connecting-ip": address, cookie })
}

type EvalOptions = { keys: string[]; arguments: string[] }

describe("recommendation mutation admission", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    redisMocks.createClient.mockReset()
    resetRecommendationMutationAdmissionForTests()
  })

  it("accumulates one anonymous client across fresh cookie identities", async () => {
    const admit = createRecommendationMutationAdmission({
      production: false,
      redis: async () => null,
      secret: "test-recommendation-admission-secret-123456",
      now: () => 1_000,
    })

    for (
      let attempt = 0;
      attempt < RECOMMENDATION_MUTATION_CLIENT_LIMIT;
      attempt += 1
    ) {
      await expect(
        admit(
          headers("203.0.113.8", `fresh-cookie-${attempt}`),
          "profile-mutation",
        ),
      ).resolves.toEqual({ allowed: true })
    }
    await expect(
      admit(headers("203.0.113.8", "another-fresh-cookie"), "profile-mutation"),
    ).resolves.toEqual({ allowed: false, reason: "rate_limited" })
  })

  it("keeps status traffic from consuming the privacy-control budget", async () => {
    const admit = createRecommendationMutationAdmission({
      production: false,
      redis: async () => null,
      secret: "test-recommendation-admission-secret-123456",
      now: () => 1_000,
    })
    const clientHeaders = headers("203.0.113.88")

    for (
      let attempt = 0;
      attempt < RECOMMENDATION_MUTATION_CLIENT_LIMIT;
      attempt += 1
    ) {
      await expect(admit(clientHeaders, "profile-status")).resolves.toEqual({
        allowed: true,
      })
    }

    await expect(admit(clientHeaders, "profile-status")).resolves.toEqual({
      allowed: false,
      reason: "rate_limited",
    })
    await expect(admit(clientHeaders, "privacy-control")).resolves.toEqual({
      allowed: true,
    })
  })

  it("sends only HMAC digests and an aggregate bucket to Redis", async () => {
    const evalMock = vi.fn(async (_script: string, _options: EvalOptions) => [
      "allowed",
    ])
    const admit = createRecommendationMutationAdmission({
      production: true,
      redis: async () => ({
        time: async () => ["10", "500000"],
        eval: evalMock,
      }),
      secret: "test-recommendation-admission-secret-123456",
      now: () => 9_000_000_000,
      monotonicNow: () => 100,
    })

    await expect(
      admit(headers("198.51.100.42"), "content-action"),
    ).resolves.toEqual({ allowed: true })
    const serialized = JSON.stringify(evalMock.mock.calls)
    expect(serialized).not.toContain("198.51.100.42")
    expect(serialized).toMatch(
      /recommendation:admission:content-action:client:[a-f0-9]{64}/,
    )
    expect(serialized).toMatch(
      /recommendation:admission:content-action:aggregate:[a-f0-9]{64}/,
    )
    expect(evalMock.mock.calls[0]?.[1].arguments[3]).toBe("10750")
  })

  it("checks a Redis-clock deadline before the first admission mutation", async () => {
    const evalMock = vi.fn(async (_script: string, _options: EvalOptions) => [
      "unavailable",
    ])
    let monotonicCall = 0
    const admit = createRecommendationMutationAdmission({
      production: true,
      redis: async () => ({
        time: async () => ["100", "500000"],
        eval: evalMock,
      }),
      secret: "test-recommendation-admission-secret-123456",
      now: () => 9_000_000_000,
      monotonicNow: () => (monotonicCall++ === 0 ? 1_000 : 1_025),
    })

    await expect(
      admit(headers("198.51.100.8"), "profile-mutation"),
    ).resolves.toEqual({
      allowed: false,
      reason: "admission_unavailable",
    })
    const [script, options] = evalMock.mock.calls[0]!
    expect(options.arguments[3]).toBe("100725")
    expect(script.indexOf("now_ms >=")).toBeLessThan(
      script.indexOf("redis.call('GET'"),
    )
  })

  it("fails closed in production when Redis or HMAC configuration is unavailable", async () => {
    const noRedis = createRecommendationMutationAdmission({
      production: true,
      redis: async () => null,
      secret: "test-recommendation-admission-secret-123456",
    })
    const noSecret = createRecommendationMutationAdmission({
      production: true,
      redis: async () => ({ time: vi.fn(), eval: vi.fn() }),
      secret: null,
    })

    await expect(
      noRedis(headers("192.0.2.1"), "profile-mutation"),
    ).resolves.toEqual({
      allowed: false,
      reason: "admission_unavailable",
    })
    await expect(
      noSecret(headers("192.0.2.1"), "profile-mutation"),
    ).resolves.toEqual({
      allowed: false,
      reason: "admission_unavailable",
    })
  })

  it("retries Redis after a bounded startup backoff", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"))
    vi.stubEnv("REDIS_URL", "redis://local.test:6379")
    const failedClient = {
      on: vi.fn(),
      connect: vi.fn().mockRejectedValue(new Error("starting")),
      destroy: vi.fn(),
    }
    const recoveredClient = {
      on: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      time: vi.fn().mockResolvedValue(["100", "0"]),
      eval: vi.fn().mockResolvedValue(["allowed"]),
    }
    redisMocks.createClient
      .mockReturnValueOnce(failedClient)
      .mockReturnValueOnce(recoveredClient)
    const admit = createRecommendationMutationAdmission({
      production: true,
      secret: "test-recommendation-admission-secret-123456",
    })

    await expect(
      admit(headers("203.0.113.10"), "profile-mutation"),
    ).resolves.toEqual({
      allowed: false,
      reason: "admission_unavailable",
    })
    await expect(
      admit(headers("203.0.113.10"), "profile-mutation"),
    ).resolves.toEqual({
      allowed: false,
      reason: "admission_unavailable",
    })
    expect(redisMocks.createClient).toHaveBeenCalledTimes(1)
    expect(failedClient.destroy).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(1_000)
    await expect(
      admit(headers("203.0.113.10"), "profile-mutation"),
    ).resolves.toEqual({
      allowed: true,
    })
    expect(redisMocks.createClient).toHaveBeenCalledTimes(2)
  })

  it("destroys a Redis client whose connection attempt times out", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"))
    vi.stubEnv("REDIS_URL", "redis://local.test:6379")
    const client = {
      on: vi.fn(),
      connect: vi.fn(() => new Promise(() => undefined)),
      destroy: vi.fn(),
    }
    redisMocks.createClient.mockReturnValue(client)
    const admit = createRecommendationMutationAdmission({
      production: true,
      secret: "test-recommendation-admission-secret-123456",
    })

    const result = admit(headers("203.0.113.11"), "profile-mutation")
    await vi.advanceTimersByTimeAsync(251)

    await expect(result).resolves.toEqual({
      allowed: false,
      reason: "admission_unavailable",
    })
    expect(client.destroy).toHaveBeenCalledOnce()
    expect(redisMocks.createClient).toHaveBeenCalledWith({
      url: "redis://local.test:6379",
      socket: { connectTimeout: 250, reconnectStrategy: false },
    })
  })

  it("retires a connected Redis client when a command times out", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"))
    vi.stubEnv("REDIS_URL", "redis://local.test:6379")
    const client = {
      on: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      time: vi.fn(() => new Promise<string[]>(() => undefined)),
      eval: vi.fn(),
      destroy: vi.fn(),
    }
    redisMocks.createClient.mockReturnValue(client)
    const admit = createRecommendationMutationAdmission({
      production: true,
      secret: "test-recommendation-admission-secret-123456",
    })

    const result = admit(headers("203.0.113.12"), "content-action")
    await vi.advanceTimersByTimeAsync(251)

    await expect(result).resolves.toEqual({
      allowed: false,
      reason: "admission_unavailable",
    })
    expect(client.destroy).toHaveBeenCalledOnce()

    await expect(
      admit(headers("203.0.113.12"), "content-action"),
    ).resolves.toEqual({
      allowed: false,
      reason: "admission_unavailable",
    })
    expect(redisMocks.createClient).toHaveBeenCalledOnce()
  })
})

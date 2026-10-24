import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"

const redisMocks = vi.hoisted(() => ({
  getRedisClient: vi.fn(),
}))

vi.mock("@/config/env", () => ({ env: { NODE_ENV: "test" } }))
vi.mock("@/infra/redis", () => ({
  getRedisClient: redisMocks.getRedisClient,
}))

import { createRecommendationDeliveryAdmission } from "./admission"

describe("recommendation delivery admission", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    redisMocks.getRedisClient.mockReturnValue(null)
  })

  it("isolates independent sessions while bounding aggregate Web traffic", async () => {
    const admission = createRecommendationDeliveryAdmission()
    const namespace = randomUUID()
    const webConsumerBucketKey = `web-consumer-${namespace}`

    // More than the old shared 60/minute bearer ceiling must remain available
    // because each request represents an independent anonymous session.
    for (let attempt = 0; attempt < 61; attempt += 1) {
      const result = await admission.acquire({
        sessionDigest: `${namespace}-session-${attempt}`,
        webConsumerBucketKey,
        seedMediaId: `seed-${attempt}`,
        locale: "en",
      })
      expect(result.allowed).toBe(true)
      if (result.allowed) await admission.release(result.leaseId)
    }

    // The shared bearer is still explicitly bounded, just at a ceiling sized
    // for aggregate Web traffic rather than one viewer.
    for (let attempt = 61; attempt < 600; attempt += 1) {
      const result = await admission.acquire({
        sessionDigest: `${namespace}-session-${attempt}`,
        webConsumerBucketKey,
        seedMediaId: `seed-${attempt}`,
        locale: "en",
      })
      expect(result.allowed).toBe(true)
      if (result.allowed) await admission.release(result.leaseId)
    }

    await expect(
      admission.acquire({
        sessionDigest: `${namespace}-session-over-limit`,
        webConsumerBucketKey,
        seedMediaId: "seed-over-limit",
        locale: "en",
      }),
    ).resolves.toEqual({ allowed: false, reason: "endpoint_rate" })

    const independentConsumer = await admission.acquire({
      sessionDigest: `${namespace}-independent-session`,
      webConsumerBucketKey: `other-consumer-${namespace}`,
      seedMediaId: "seed-independent",
      locale: "en",
    })
    expect(independentConsumer.allowed).toBe(true)
    if (independentConsumer.allowed) {
      await admission.release(independentConsumer.leaseId)
    }
  })

  it("uses only a one-way Web consumer key in the atomic Redis operation", async () => {
    const evalMock = vi.fn().mockResolvedValue(["endpoint_rate"])
    redisMocks.getRedisClient.mockReturnValue({
      time: vi.fn().mockResolvedValue(["1770000000", "500000"]),
      eval: evalMock,
    })
    const admission = createRecommendationDeliveryAdmission()
    const rawBucketKey = "raw-web-bearer-secret"

    await expect(
      admission.acquire({
        sessionDigest: "a".repeat(64),
        webConsumerBucketKey: rawBucketKey,
        seedMediaId: "seed-video",
        locale: "en",
      }),
    ).resolves.toEqual({ allowed: false, reason: "endpoint_rate" })

    expect(evalMock).toHaveBeenCalledWith(
      expect.any(String),
      5,
      expect.stringMatching(/^recommendation:delivery:inflight:[a-f0-9]{64}$/),
      expect.stringMatching(/^recommendation:delivery:cooldown:[a-f0-9]{64}:/),
      expect.stringMatching(/^recommendation:delivery:hour:[a-f0-9]{64}$/),
      expect.stringMatching(
        /^recommendation:delivery:endpoint:client:[a-f0-9]{64}$/,
      ),
      expect.stringMatching(
        /^recommendation:delivery:endpoint:aggregate:[a-f0-9]{64}$/,
      ),
      expect.any(String),
      10_000,
      5_000,
      30,
      3_600_000,
      60,
      60_000,
      600,
      60_000,
      expect.any(Number),
    )
    const script = String(evalMock.mock.calls[0]?.[0])
    expect(script).toContain("redis.call('TIME')")
    expect(script.indexOf("deadline_elapsed")).toBeLessThan(
      script.indexOf("redis.call('EXISTS'"),
    )
    expect(JSON.stringify(evalMock.mock.calls)).not.toContain(rawBucketKey)
  })
})

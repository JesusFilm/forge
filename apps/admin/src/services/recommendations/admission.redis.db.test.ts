import { createHash, randomUUID } from "node:crypto"
import Redis from "ioredis"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const redisMocks = vi.hoisted(() => ({ getRedisClient: vi.fn() }))

vi.mock("@/config/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/env")>()
  return { ...original, env: { ...original.env, NODE_ENV: "production" } }
})
vi.mock("@/infra/redis", () => ({
  getRedisClient: redisMocks.getRedisClient,
}))

import { env } from "@/config/env"
import { createRecommendationDeliveryAdmission } from "./admission"

const RUN_REDIS_TEST = env.RECOMMENDATION_REDIS_TEST === "1"

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex")

describe.skipIf(!RUN_REDIS_TEST)("recommendation Redis admission", () => {
  let redis: Redis
  const keys = new Set<string>()

  beforeAll(async () => {
    redis = new Redis({
      host: env.REDIS_HOST ?? "127.0.0.1",
      port: env.REDIS_PORT ?? 6379,
      maxRetriesPerRequest: 1,
    })
    await redis.ping()
    redisMocks.getRedisClient.mockReturnValue(redis)
  })

  afterAll(async () => {
    if (keys.size > 0) await redis.del(...keys)
    await redis.quit()
  })

  it("executes atomic in-flight, owner release, and seed cooldown rules", async () => {
    const namespace = randomUUID()
    const sessionDigest = digest(`${namespace}:session`)
    const webConsumerBucketKey = `${namespace}:consumer`
    const seedMediaId = `${namespace}:seed`
    const locale = "en"
    const sessionKey = digest(sessionDigest)
    const seedKey = digest(`${seedMediaId}\0${locale}`)
    keys.add(`recommendation:delivery:inflight:${sessionKey}`)
    keys.add(`recommendation:delivery:cooldown:${sessionKey}:${seedKey}`)
    keys.add(`recommendation:delivery:hour:${sessionKey}`)
    keys.add(
      `recommendation:delivery:endpoint:client:${digest(`recommendation-client-session\0${sessionDigest}`)}`,
    )
    keys.add(
      `recommendation:delivery:endpoint:aggregate:${digest(`recommendation-web-consumer\0${webConsumerBucketKey}`)}`,
    )

    const first = createRecommendationDeliveryAdmission()
    const second = createRecommendationDeliveryAdmission()
    const input = {
      sessionDigest,
      webConsumerBucketKey,
      seedMediaId,
      locale,
    }
    const admitted = await first.acquire(input)
    expect(admitted.allowed).toBe(true)
    if (!admitted.allowed) throw new Error("expected Redis admission lease")

    await expect(second.acquire(input)).resolves.toEqual({
      allowed: false,
      reason: "in_flight",
    })
    await second.release("not-the-owner")
    await expect(
      redis.get(`recommendation:delivery:inflight:${sessionKey}`),
    ).resolves.toBe(admitted.leaseId)

    await first.release(admitted.leaseId)
    await expect(
      redis.get(`recommendation:delivery:inflight:${sessionKey}`),
    ).resolves.toBeNull()
    await expect(second.acquire(input)).resolves.toEqual({
      allowed: false,
      reason: "cooldown",
    })
  })

  it("does not mutate any bucket after the Redis-clock deadline", async () => {
    const namespace = randomUUID()
    const input = {
      sessionDigest: digest(`${namespace}:session`),
      webConsumerBucketKey: `${namespace}:consumer`,
      seedMediaId: `${namespace}:seed`,
      locale: "en",
    }
    const evalSpy = vi.spyOn(redis, "eval")
    const admission = createRecommendationDeliveryAdmission()
    await admission.acquire(input)
    const call = evalSpy.mock.calls[0]
    expect(call).toBeDefined()
    if (!call) return

    const replay = [...call]
    replay[replay.length - 1] = 0
    const keysUsed = replay.slice(2, 7).map(String)
    keysUsed.forEach((key) => keys.add(key))
    await redis.del(...keysUsed)
    await expect(
      redis.eval(
        replay[0] as string,
        ...(replay.slice(1) as [number, ...Array<string | number>]),
      ),
    ).resolves.toEqual(["deadline_elapsed"])
    await expect(redis.mget(...keysUsed)).resolves.toEqual(
      Array(keysUsed.length).fill(null),
    )
    evalSpy.mockRestore()
  })
})

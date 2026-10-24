import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { connection, redis } = vi.hoisted(() => {
  const connection: { error: Error | null } = { error: null }
  return {
    connection,
    redis: {
      ping: vi.fn(async () => {
        if (connection.error) throw connection.error
        return "PONG"
      }),
      get: vi.fn(
        (_key: string, callback: (error: Error | null, value: null) => void) =>
          callback(connection.error, null),
      ),
      set: vi.fn((_args: unknown, callback: (error: Error | null) => void) =>
        callback(connection.error),
      ),
    },
  }
})

vi.mock("@/config/env", () => ({ env: { NODE_ENV: "production" } }))
vi.mock("@/infra/redis", () => ({
  hasRedisConfig: () => true,
  getRedisClient: () => redis,
}))
vi.mock("@/app/api/graphql/route", async () => {
  // Model GraphQL loading its real rate-limit plugin, not a successful request.
  await import("./rate-limit")
  return {}
})

const PRELOAD_ENTRIES = Symbol.for("forge.next.preloadEntries")
const runtime = globalThis as typeof globalThis & {
  [PRELOAD_ENTRIES]?: Promise<void>
}
const original = runtime[PRELOAD_ENTRIES]

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv("NEXT_PHASE", "")
  connection.error = null
  runtime[PRELOAD_ENTRIES] = Promise.resolve()
})

afterEach(() => {
  vi.unstubAllEnvs()
  if (original) runtime[PRELOAD_ENTRIES] = original
  else delete runtime[PRELOAD_ENTRIES]
})

describe("production rate-limit availability", () => {
  it("reports unavailable while Redis reads and writes fail closed after initialization", async () => {
    const unavailable = new Error("rate-limit store unavailable")
    connection.error = unavailable
    const { GET } = await import("@/app/api/health/route")
    const { rateLimitPluginOptions } = await import("./rate-limit")

    expect((await GET()).status).toBe(503)
    expect(redis.get).not.toHaveBeenCalled()
    expect(redis.set).not.toHaveBeenCalled()

    const identity = {
      contextIdentity: "synthetic-test-consumer",
      fieldIdentity: "Mutation.recordSemanticRecommendationPlayback",
    }
    await expect(
      rateLimitPluginOptions.store.getForIdentity(identity),
    ).rejects.toBe(unavailable)
    await expect(
      rateLimitPluginOptions.store.setForIdentity(
        identity,
        [Date.now()],
        60_000,
      ),
    ).rejects.toBe(unavailable)
    expect(redis.get).toHaveBeenCalledOnce()
    expect(redis.set).toHaveBeenCalledOnce()
  })

  it("recovers using the shared Redis store without an in-memory fallback", async () => {
    const { GET } = await import("@/app/api/health/route")
    const { rateLimitPluginOptions } = await import("./rate-limit")
    const identity = {
      contextIdentity: "synthetic-test-consumer",
      fieldIdentity: "Mutation.recordSemanticRecommendationPlayback",
    }
    connection.error = new Error("temporary disconnect")
    await expect(
      rateLimitPluginOptions.store.getForIdentity(identity),
    ).rejects.toThrow("temporary disconnect")
    connection.error = null

    await expect(
      rateLimitPluginOptions.store.getForIdentity(identity),
    ).resolves.toEqual([])
    await expect(
      rateLimitPluginOptions.store.setForIdentity(
        identity,
        [Date.now()],
        60_000,
      ),
    ).resolves.toBeUndefined()
    expect((await GET()).status).toBe(200)
    expect(redis.get).toHaveBeenCalledTimes(2)
    expect(redis.set).toHaveBeenCalledOnce()
  })
})

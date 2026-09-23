import { createSchema, createYoga } from "graphql-yoga"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

const { redis } = vi.hoisted(() => ({ redis: { get: vi.fn(), set: vi.fn() } }))
vi.mock("@/config/env", () => ({ env: { NODE_ENV: "production" } }))
vi.mock("@/infra/redis", () => ({
  hasRedisConfig: () => true,
  getRedisClient: () => redis,
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  redis.get.mockImplementation((_key, callback) => callback(null, null))
  redis.set.mockImplementation((_args, callback) => callback(null))
})
afterEach(() => vi.useRealTimers())

async function fixture(requestSignal?: AbortSignal) {
  const mutate = vi.fn(() => true)
  const { rateLimitPlugin } = await import("./rate-limit")
  const yoga = createYoga({
    logging: false,
    plugins: [
      {
        onContextBuilding({ extendContext }) {
          if (requestSignal)
            extendContext({
              request: new Request("http://localhost/graphql", {
                signal: requestSignal,
              }),
            })
        },
      },
      rateLimitPlugin,
    ],
    context: ({ request }) => ({
      request,
      user: { role: "CONSUMER_BEARER", rateLimitBucketKey: "fixture" },
    }),
    schema: createSchema({
      typeDefs:
        "type Query { ready: Boolean! } type Mutation { mutate: Boolean! }",
      resolvers: { Mutation: { mutate } },
    }),
  })
  return {
    mutate,
    request: (signal?: AbortSignal) =>
      yoga.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: "mutation { mutate }" }),
          signal,
        }),
      ),
  }
}

it.each(["get", "set"] as const)(
  "rejects stalled %s before execution even after late settlement",
  async (method) => {
    const { request, mutate } = await fixture()
    let finish!: () => void
    redis[method].mockImplementation((_args, callback) => {
      finish = () => callback(null, null)
    })
    const response = request()
    await vi.advanceTimersByTimeAsync(501)
    expect((await response).status).toBe(500)
    expect(mutate).not.toHaveBeenCalled()
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(mutate).not.toHaveBeenCalled()
    if (method === "get") expect(redis.set).not.toHaveBeenCalled()
  },
)

it("checks caller cancellation after admission without executing the mutation", async () => {
  const controller = new AbortController()
  const { request, mutate } = await fixture(controller.signal)
  let finish!: () => void
  redis.get.mockImplementation((_args, callback) => {
    finish = () => callback(null, null)
  })
  const response = request()
  await vi.advanceTimersByTimeAsync(0)
  controller.abort()
  finish()
  await vi.advanceTimersByTimeAsync(0)
  expect(await (await response).json()).toMatchObject({
    errors: expect.any(Array),
  })
  expect(mutate).not.toHaveBeenCalled()
})

it("does not begin Redis work for an already-aborted caller", async () => {
  const controller = new AbortController()
  const { request, mutate } = await fixture(controller.signal)
  controller.abort()
  expect(await (await request()).json()).toMatchObject({
    errors: expect.any(Array),
  })
  expect(redis.get).not.toHaveBeenCalled()
  expect(mutate).not.toHaveBeenCalled()
})

it("admits healthy concurrent requests with separate identities", async () => {
  const { request, mutate } = await fixture()
  const responses = await Promise.all(
    Array.from({ length: 100 }, () => request()),
  )
  expect(responses.every((response) => response.status === 200)).toBe(true)
  expect(mutate).toHaveBeenCalledTimes(100)
})

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { settings, initialize, execute, ping } = vi.hoisted(() => ({
  settings: { NODE_ENV: "production" },
  initialize: vi.fn(),
  execute: vi.fn(),
  ping: vi.fn(),
}))
vi.mock("@/config/env", () => ({ env: settings }))
vi.mock("@/infra/redis", () => ({ getRedisClient: () => ({ ping }) }))

const PRELOAD_ENTRIES = Symbol.for("forge.next.preloadEntries")
const runtime = globalThis as typeof globalThis & {
  [PRELOAD_ENTRIES]?: Promise<void>
}
const original = runtime[PRELOAD_ENTRIES]

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  settings.NODE_ENV = "production"
  initialize.mockResolvedValue(undefined)
  ping.mockResolvedValue("PONG")
  delete runtime[PRELOAD_ENTRIES]
  vi.doMock("@/app/api/graphql/route", async () => {
    await initialize()
    return { GET: execute, POST: execute, OPTIONS: execute }
  })
})

afterEach(() => {
  vi.useRealTimers()
  if (original) runtime[PRELOAD_ENTRIES] = original
  else delete runtime[PRELOAD_ENTRIES]
})

describe("Admin startup readiness", () => {
  it("fails readiness during Redis failure and recovers on the next probe", async () => {
    runtime[PRELOAD_ENTRIES] = Promise.resolve()
    ping.mockRejectedValueOnce(new Error("offline"))
    const { GET } = await import("./route")
    expect((await GET()).status).toBe(503)
    expect((await GET()).status).toBe(200)
    expect(execute).not.toHaveBeenCalled()
  })

  it("bounds a stalled PING, shares concurrent probes, and does not queue more wire work", async () => {
    runtime[PRELOAD_ENTRIES] = Promise.resolve()
    let finish!: (value: string) => void
    ping.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finish = resolve
      }),
    )
    const { GET } = await import("./route")
    const first = GET()
    const concurrent = GET()
    expect((await first).status).toBe(503)
    expect((await concurrent).status).toBe(503)
    expect((await GET()).status).toBe(503)
    expect(ping).toHaveBeenCalledOnce()
    finish("PONG")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect((await GET()).status).toBe(200)
    expect(ping).toHaveBeenCalledTimes(2)
  })

  it("does not report healthy before background entry loading finishes", async () => {
    let finish!: () => void
    runtime[PRELOAD_ENTRIES] = new Promise<void>((resolve) => {
      finish = resolve
    })
    const { GET } = await import("./route")
    const observed = vi.fn()
    const response = GET().then((value) => {
      observed()
      return value
    })
    await Promise.resolve()
    expect(observed).not.toHaveBeenCalled()
    expect(initialize).not.toHaveBeenCalled()

    finish()
    const ready = await response
    expect(ready.status).toBe(200)
    expect(await ready.json()).toEqual({ status: "ok" })
    expect(initialize).toHaveBeenCalledOnce()
    expect(execute).not.toHaveBeenCalled()
  })

  it("fails closed when the pinned framework readiness hook is missing", async () => {
    const { GET } = await import("./route")
    const response = await GET()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: "starting" })
    expect(initialize).not.toHaveBeenCalled()
  })

  it("does not hide a failed preload behind a healthy response", async () => {
    const { GET } = await import("./route")
    runtime[PRELOAD_ENTRIES] = Promise.reject(new Error("preload failed"))
    // Attach the readiness observer in the same turn as the rejection.
    await expect(GET()).rejects.toThrow("preload failed")
  })

  it("fails readiness if GraphQL initialization was skipped by the preloader", async () => {
    runtime[PRELOAD_ENTRIES] = Promise.resolve()
    const failure = new Error("GraphQL initialization failed")
    initialize.mockRejectedValueOnce(failure)
    const { GET } = await import("./route")
    // Vitest wraps errors thrown while loading a mocked module.
    await expect(GET()).rejects.toMatchObject({ cause: failure })
    expect(execute).not.toHaveBeenCalled()
  })

  it("keeps development independent of production entry preloading", async () => {
    settings.NODE_ENV = "development"
    const { GET } = await import("./route")
    expect((await GET()).status).toBe(200)
    expect(initialize).not.toHaveBeenCalled()
  })
})

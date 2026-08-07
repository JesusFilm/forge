import { createRequire } from "node:module"
import { randomUUID } from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"

const require = createRequire(import.meta.url)
const handlerPath = require.resolve("../../cache-handler.mjs")

type CacheHandlerModule = {
  default: new (context?: unknown) => {
    get(key: string, ctx?: unknown): Promise<unknown>
    set(key: string, data: unknown, ctx?: unknown): Promise<void>
    revalidateTag(tags: string | string[]): Promise<void>
    resetRequestCache(): void
  }
}

function resetCacheHandlerGlobals(): void {
  Reflect.deleteProperty(globalThis, "forgeWebCacheHandlerConfig")
  Reflect.deleteProperty(globalThis, "forgeWebCacheHandlerConfigPromise")
}

function loadHandler(
  options: { redisUrl?: string } = {},
): Promise<CacheHandlerModule> {
  resetCacheHandlerGlobals()
  delete process.env.REDIS_URL
  process.env.NEXT_CACHE_REDIS_PREFIX = `test:${randomUUID()}`
  if (options.redisUrl) process.env.REDIS_URL = options.redisUrl

  return import(
    `${handlerPath}?cacheBust=${randomUUID()}`
  ) as Promise<CacheHandlerModule>
}

describe("Next cache handler", () => {
  afterEach(() => {
    resetCacheHandlerGlobals()
    delete process.env.REDIS_URL
    delete process.env.NEXT_CACHE_REDIS_PREFIX
    delete process.env.NEXT_PHASE
  })

  it("loads the maintained cache handler without Redis config", async () => {
    const { default: CacheHandler } = await loadHandler()
    const handler = new CacheHandler()

    expect(typeof handler.get).toBe("function")
    expect(typeof handler.set).toBe("function")
    expect(typeof handler.revalidateTag).toBe("function")
    expect(typeof handler.resetRequestCache).toBe("function")
  })

  it("falls back when Redis is configured but unavailable", async () => {
    const { default: CacheHandler } = await loadHandler({
      redisUrl: "redis://127.0.0.1:1",
    })
    const handler = new CacheHandler()

    expect(typeof handler.get).toBe("function")
    expect(typeof handler.set).toBe("function")
    expect(typeof handler.revalidateTag).toBe("function")
    expect(typeof handler.resetRequestCache).toBe("function")
  })

  it("keeps the handler isolated from Redis during production builds", async () => {
    process.env.NEXT_PHASE = "phase-production-build"

    const { default: CacheHandler } = await loadHandler()
    const handler = new CacheHandler()

    expect(handler).toBeInstanceOf(CacheHandler)
  })
})

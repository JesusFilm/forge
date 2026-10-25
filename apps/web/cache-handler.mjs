import { performance } from "node:perf_hooks"

import { CacheHandler } from "@fortedigital/nextjs-cache-handler"
import createLruHandler from "@fortedigital/nextjs-cache-handler/local-lru"
import createRedisHandler from "@fortedigital/nextjs-cache-handler/redis-strings"
import { PHASE_PRODUCTION_BUILD } from "next/constants.js"
import { createClient } from "redis"

const DEFAULT_PREFIX = "forge:web:next-cache:"

// Installed by src/observability/next-cache-telemetry.ts in production. When it
// is absent every hook below is a pass-through (feat-745).
const TELEMETRY_KEY = Symbol.for("forge.web.nextCacheTelemetry")

function telemetry() {
  return globalThis[TELEMETRY_KEY]
}

// Telemetry must never change a cache result or replace a cache error.
function observe(action) {
  try {
    action(telemetry())
  } catch {
    // Dropped on purpose.
  }
}

// Same JSON format as the handler's default serializer, with parse/stringify
// elapsed time recorded. The rest of a slow read stays unattributed: Redis
// round trips, base64 conversion, tag checks and scheduling delay.
export const timedJsonSerializer = {
  serialize(value) {
    const startMs = performance.now()
    const text = JSON.stringify(value)
    const ms = performance.now() - startMs
    observe((recorder) => recorder?.noteCodec("encode", ms, text.length))
    return text
  },
  deserialize(stored) {
    const text = typeof stored === "string" ? stored : String(stored)
    const startMs = performance.now()
    const value = JSON.parse(text)
    const ms = performance.now() - startMs
    observe((recorder) => recorder?.noteCodec("decode", ms, text.length))
    return value
  },
}

// The base CacheHandler swallows store errors and reports them as a miss (get)
// or ignores them (set). Record them before they disappear; behaviour is
// unchanged because the error is rethrown to the same caller.
export function instrumentStore(store) {
  return {
    ...store,
    async get(key, meta) {
      try {
        const value = await store.get(key, meta)
        observe((recorder) => recorder?.noteResult(Boolean(value)))
        return value
      } catch (error) {
        observe((recorder) => recorder?.noteError(error))
        throw error
      }
    },
    async set(key, value, ctx) {
      try {
        return await store.set(key, value, ctx)
      } catch (error) {
        observe((recorder) => recorder?.noteError(error))
        throw error
      }
    },
  }
}

function cachePrefix() {
  const prefix = process.env.NEXT_CACHE_REDIS_PREFIX || DEFAULT_PREFIX
  return prefix.endsWith(":") ? prefix : `${prefix}:`
}

function logDebug(message, error) {
  if (process.env.NEXT_PRIVATE_DEBUG_CACHE === undefined) return
  const detail = error instanceof Error ? error.message : String(error)
  console.warn(`[next-cache] ${message}: ${detail}`)
}

CacheHandler.onCreation(() => {
  if (globalThis.forgeWebCacheHandlerConfig) {
    return globalThis.forgeWebCacheHandlerConfig
  }

  if (globalThis.forgeWebCacheHandlerConfigPromise) {
    return globalThis.forgeWebCacheHandlerConfigPromise
  }

  globalThis.forgeWebCacheHandlerConfigPromise = createCacheHandlerConfig()
  return globalThis.forgeWebCacheHandlerConfigPromise
})

async function createCacheHandlerConfig() {
  if (
    process.env.NODE_ENV === "development" ||
    process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD ||
    !process.env.REDIS_URL
  ) {
    return finishConfig({ handlers: [createLruHandler()] })
  }

  let client = null

  try {
    client = createClient({
      url: process.env.REDIS_URL,
      pingInterval: 10_000,
    })

    client.on("error", (error) => {
      logDebug("redis error", error)
      globalThis.forgeWebCacheHandlerConfig = null
      globalThis.forgeWebCacheHandlerConfigPromise = null
    })

    await client.connect()
  } catch (error) {
    logDebug("redis connect failed", error)
    await client?.disconnect().catch(() => {})
    return finishConfig({ handlers: [createLruHandler()] })
  }

  const redisCache = instrumentStore(
    createRedisHandler({
      client,
      keyPrefix: cachePrefix(),
      valueSerializer: timedJsonSerializer,
    }),
  )

  return finishConfig({
    handlers: [redisCache],
  })
}

function finishConfig(config) {
  globalThis.forgeWebCacheHandlerConfigPromise = null
  globalThis.forgeWebCacheHandlerConfig = config
  return config
}

// Next passes the cache kind only to the class method, so the span opens here
// and the store hooks above annotate it through async context. If the
// recorder itself fails, the cache call runs (once) without it.
async function measured(op, kind, call) {
  let started
  const once = () => (started ??= call())
  try {
    const traced = telemetry()?.measure(op, kind, once)
    if (traced) return await traced
  } catch {
    // Settle on the cache call's own outcome, never on a telemetry error.
    return started ?? once()
  }
  return once()
}

export class InstrumentedCacheHandler extends CacheHandler {
  async get(cacheKey, ctx) {
    return measured("get", ctx?.kind, () => super.get(cacheKey, ctx))
  }

  async set(cacheKey, value, ctx) {
    return measured("set", value?.kind, () => super.set(cacheKey, value, ctx))
  }
}

export default InstrumentedCacheHandler

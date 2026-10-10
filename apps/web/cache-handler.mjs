import { CacheHandler } from "@fortedigital/nextjs-cache-handler"
import createLruHandler from "@fortedigital/nextjs-cache-handler/local-lru"
import createRedisHandler from "@fortedigital/nextjs-cache-handler/redis-strings"
import { PHASE_PRODUCTION_BUILD } from "next/constants.js"
import { createClient } from "redis"

const DEFAULT_PREFIX = "forge:web:next-cache:"

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

  const redisCache = createRedisHandler({
    client,
    keyPrefix: cachePrefix(),
  })

  return finishConfig({
    handlers: [redisCache],
  })
}

function finishConfig(config) {
  globalThis.forgeWebCacheHandlerConfigPromise = null
  globalThis.forgeWebCacheHandlerConfig = config
  return config
}

export default CacheHandler

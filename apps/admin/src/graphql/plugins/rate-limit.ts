// GraphQL rate limiter — operation-scope, Redis-backed in production.
//
// Keyed by user.id for authenticated callers, CF-Connecting-IP for
// unauthenticated. Each anonymous IP gets its own bucket so one
// attacker cannot exhaust the limit for all public users.
//
// Defaults: 60 queries/min authenticated, 30 mutations/min.

import {
  useRateLimiter,
  InMemoryStore,
  RedisStore,
} from "@envelop/rate-limiter"
import { env } from "@/config/env"
import type { ContextShape } from "@/graphql/builder"
import { getRedisClient, hasRedisConfig } from "@/infra/redis"

type RateLimitStore = Pick<InMemoryStore, "getForIdentity" | "setForIdentity">

function getClientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  )
}

export const rateLimitPlugin = useRateLimiter({
  identifyFn: (context) => {
    const ctx = context as ContextShape
    if (ctx.user?.id) return ctx.user.id
    return `public:${getClientIp(ctx.request)}`
  },
  store: createRateLimitStore(),
  configByField: [
    { type: "Query", field: "*", max: 60, window: "1m" },
    { type: "Mutation", field: "*", max: 30, window: "1m" },
  ],
})

function createRateLimitStore(): RateLimitStore {
  let store: RateLimitStore | null = null

  function resolveStore(): RateLimitStore {
    if (store) {
      return store
    }
    store = createConfiguredRateLimitStore()
    return store
  }

  return {
    getForIdentity(identity) {
      return resolveStore().getForIdentity(identity)
    },
    setForIdentity(identity, timestamps, windowMs) {
      return resolveStore().setForIdentity(identity, timestamps, windowMs)
    },
  }
}

function createConfiguredRateLimitStore(): RateLimitStore {
  if (!hasRedisConfig()) {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "REDIS_HOST and REDIS_PORT are required for GraphQL rate limiting in production.",
      )
    }
    return new InMemoryStore()
  }

  const redis = getRedisClient()
  if (!redis) {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "Redis is required for GraphQL rate limiting in production.",
      )
    }
    return new InMemoryStore()
  }

  const redisStore = new RedisStore(redis)
  const fallbackStore = new InMemoryStore()

  return {
    async getForIdentity(identity) {
      try {
        return await redisStore.getForIdentity(identity)
      } catch (error) {
        if (env.NODE_ENV === "production") {
          throw error
        }
        return fallbackStore.getForIdentity(identity)
      }
    },
    async setForIdentity(identity, timestamps, windowMs) {
      try {
        await redisStore.setForIdentity(identity, timestamps, windowMs)
      } catch (error) {
        if (env.NODE_ENV === "production") {
          throw error
        }
        await fallbackStore.setForIdentity(identity, timestamps, windowMs)
      }
    },
  }
}

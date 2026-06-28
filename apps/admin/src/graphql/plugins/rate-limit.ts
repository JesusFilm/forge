// GraphQL rate limiter — operation-scope, Redis-backed in production.
//
// Keyed by user.id for authenticated callers, CF-Connecting-IP for
// unauthenticated. Each anonymous IP gets its own bucket so one
// attacker cannot exhaust the limit for all public users.
//
// Plan 003 (U1) adds a third bucket class for consumer-app SSR: when
// the request mints a `CONSUMER_BEARER` principal (apps/web), the
// bucket key is `consumer:<rateLimitBucketKey>`. CGNAT and mobile-
// carrier NAT collapse many real users onto one IP, so the
// anonymous-IP bucket is too coarse for a consumer-app SSR fanout —
// admin's read traffic from web SSR was previously hitting Strapi and
// will materially increase after R8 cutover.
//
// Defaults: 60 queries/min authenticated, 30 mutations/min.
//
// SECURITY: this module MUST NEVER log the raw `Authorization` header
// or any bearer key string. The `rateLimitBucketKey` field on the
// principal IS the key (already validated by `consumer-bearer.ts`)
// but identity formation here treats it as an opaque bucket label
// only — emitted only into the rate-limiter's internal store, never
// into application logs. Log scrubbing is unit-tested in
// `rate-limit.test.ts`.

import {
  useRateLimiter,
  InMemoryStore,
  RedisStore,
} from "@envelop/rate-limiter"
import { env } from "@/config/env"
import type { ContextShape } from "@/graphql/builder"
import { getRedisClient, hasRedisConfig } from "@/infra/redis"

const isNextBuild = process.env.NEXT_PHASE === "phase-production-build"

function getClientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  )
}

/**
 * Identity formation for the rate-limit bucket. Exported for direct
 * unit testing so the bucket-key logic doesn't have to be exercised
 * through the full envelop plugin lifecycle.
 *
 * Buckets, in priority order:
 *   1. Authenticated user (`ctx.user.id`) — keyed by user id.
 *   2. Consumer-app bearer (`role === "CONSUMER_BEARER"`) — keyed by
 *      the bearer's `rateLimitBucketKey` as `consumer:<key>`.
 *   3. Video mapper bearer (`role === "VIDEO_MAPPER"`) — keyed by service
 *      class as `service:video-mapper`.
 *   4. Anonymous IP fallback — `public:<cf-connecting-ip>`.
 *
 * Without a dedicated branch for the consumer bearer, CONSUMER_BEARER
 * principals would fall through to `public:<ip>` and web SSR would
 * self-DoS on its egress IP under CGNAT — the exact scenario the
 * bearer-bucket identity exists to prevent.
 */
export function identifyForRateLimit(ctx: ContextShape): string {
  if (ctx.user?.id) return ctx.user.id
  if (
    ctx.user?.role === "CONSUMER_BEARER" &&
    ctx.user.rateLimitBucketKey != null
  ) {
    return `consumer:${ctx.user.rateLimitBucketKey}`
  }
  if (ctx.user?.role === "VIDEO_MAPPER") {
    return "service:video-mapper"
  }
  return `public:${getClientIp(ctx.request)}`
}

export const rateLimitConfigByField = [
  {
    type: "Query",
    field: "watchVideoRouteSnapshotBySlug",
    max: 300,
    window: "1m",
  },
  {
    type: "Query",
    field: "!(watchVideoRouteSnapshotBySlug)",
    max: 60,
    window: "1m",
  },
  { type: "Mutation", field: "*", max: 30, window: "1m" },
]

export const rateLimitPlugin = useRateLimiter({
  identifyFn: (context) => identifyForRateLimit(context as ContextShape),
  store: createRateLimitStore(),
  configByField: rateLimitConfigByField,
})

function createRateLimitStore() {
  if (!hasRedisConfig()) {
    if (env.NODE_ENV === "production" && !isNextBuild) {
      throw new Error(
        "REDIS_HOST and REDIS_PORT are required for GraphQL rate limiting in production.",
      )
    }
    return new InMemoryStore()
  }

  const redis = getRedisClient()
  if (!redis) {
    if (env.NODE_ENV === "production" && !isNextBuild) {
      throw new Error(
        "Redis is required for GraphQL rate limiting in production.",
      )
    }
    return new InMemoryStore()
  }

  const redisStore = new RedisStore(redis)
  const fallbackStore = new InMemoryStore()

  return {
    async getForIdentity(
      identity: Parameters<typeof redisStore.getForIdentity>[0],
    ) {
      try {
        return await redisStore.getForIdentity(identity)
      } catch (error) {
        if (env.NODE_ENV === "production" && !isNextBuild) {
          throw error
        }
        return fallbackStore.getForIdentity(identity)
      }
    },
    async setForIdentity(
      identity: Parameters<typeof redisStore.setForIdentity>[0],
      timestamps: Parameters<typeof redisStore.setForIdentity>[1],
      windowMs?: Parameters<typeof redisStore.setForIdentity>[2],
    ) {
      try {
        await redisStore.setForIdentity(identity, timestamps, windowMs)
      } catch (error) {
        if (env.NODE_ENV === "production" && !isNextBuild) {
          throw error
        }
        fallbackStore.setForIdentity(identity, timestamps)
      }
    },
  }
}

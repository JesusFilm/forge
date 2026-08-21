// GraphQL rate limiter — operation-scope, Redis-backed in production.
//
// Keyed by user.id for authenticated callers, CF-Connecting-IP for
// unauthenticated. Each anonymous IP gets its own bucket so one
// attacker cannot exhaust the limit for all public users.
//
// Plan 003 (U1) adds a third bucket class for consumer-app traffic:
// Web SSR uses an internal request-scoped identity, while fleet clients
// use consumer buckets split by viewer/device. CGNAT and mobile-carrier
// NAT collapse many real users onto one IP, so the anonymous-IP bucket
// is too coarse for consumer fanout.
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
import { randomUUID } from "node:crypto"
import { env } from "@/config/env"
import type { ContextShape } from "@/graphql/builder"
import { getRedisClient, hasRedisConfig } from "@/infra/redis"

const isNextBuild = process.env.NEXT_PHASE === "phase-production-build"
const internalWebRequestIdentities = new WeakMap<Request, string>()

function getClientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  )
}

// Fleet buckets use ONLY the Cloudflare-authoritative `cf-connecting-ip`, never
// the client-supplied `x-forwarded-for`: a spoofable IP would let a holder of
// the bundle-extractable fleet key mint buckets or pin a victim's. (R8)
function getTrustedClientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown"
}

// `x-viewer-id` is a client-set, spoofable bucket LABEL (never identity/authz):
// bound it to a safe charset + length so it can't inject log structure or blow
// up Redis key cardinality; anything else falls back to the IP bucket.
const VIEWER_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/

function sanitizeViewerId(raw: string | null): string | null {
  if (raw == null) return null
  const trimmed = raw.trim()
  return VIEWER_ID_PATTERN.test(trimmed) ? trimmed : null
}

function getInternalWebRequestIdentity(
  request: Request,
  rateLimitBucketKey: string,
): string {
  const existing = internalWebRequestIdentities.get(request)
  if (existing) return existing

  // Web SSR is trusted server-to-server traffic. Keep the limiter active inside
  // a single GraphQL operation, but never let unrelated RSC requests accumulate
  // into one shared production bucket.
  const identity = `internal-web:${rateLimitBucketKey}:${randomUUID()}`
  internalWebRequestIdentities.set(request, identity)
  return identity
}

/**
 * Identity formation for the rate-limit bucket. Exported for direct
 * unit testing so the bucket-key logic doesn't have to be exercised
 * through the full envelop plugin lifecycle.
 *
 * Buckets, in priority order:
 *   1. Authenticated user (`ctx.user.id`) — keyed by user id.
 *   2. Consumer-app bearer (`role === "CONSUMER_BEARER"`) — Web SSR keys
 *      use `internal-web:<key>:<requestId>` so trusted RSC traffic never
 *      shares one field-rate-limit bucket across requests; fleet keys use
 *      `consumer:<key>` plus a per-device suffix `:v:<viewer_id>` (preferred)
 *      or `:<ip>`.
 *   3. Video mapper bearer (`role === "VIDEO_MAPPER"`) — keyed by service
 *      class as `service:video-mapper`.
 *   4. Anonymous IP fallback — `public:<cf-connecting-ip>`.
 *
 * Without a dedicated branch for the consumer bearer, CONSUMER_BEARER
 * principals would fall through to `public:<ip>`. Without the internal Web
 * request scope, web SSR would still self-DoS against one shared consumer key.
 */
export function identifyForRateLimit(ctx: ContextShape): string {
  if (ctx.user?.id) return ctx.user.id
  if (
    ctx.user?.role === "CONSUMER_BEARER" &&
    ctx.user.rateLimitBucketKey != null
  ) {
    if (ctx.user.fleet) {
      // Prefer a client-provided viewer_id (per-install, CGNAT-immune) over IP.
      // Spoofable → an availability label only; abuse stays bounded by the
      // edge/global per-key ceiling, never this key. See sanitizeViewerId.
      const viewerId = sanitizeViewerId(ctx.request.headers.get("x-viewer-id"))
      if (viewerId) {
        return `consumer:${ctx.user.rateLimitBucketKey}:v:${viewerId}`
      }
      const ip = getTrustedClientIp(ctx.request)
      return `consumer:${ctx.user.rateLimitBucketKey}:${ip}`
    }
    return getInternalWebRequestIdentity(
      ctx.request,
      ctx.user.rateLimitBucketKey,
    )
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
    field: "watchSearchSuggestions",
    max: 180,
    window: "1m",
  },
  {
    type: "Query",
    field: "myUserPlaylistCapability",
    max: 10,
    window: "1m",
  },
  {
    type: "Query",
    field: "userPlaylistByToken",
    max: 60,
    window: "1m",
  },
  {
    type: "Query",
    field: "(myUserPlaylists|myUserPlaylist|userPlaylistReportQueue)",
    max: 120,
    window: "1m",
  },
  {
    type: "Query",
    field:
      "!(watchVideoRouteSnapshotBySlug|watchSearchSuggestions|myUserPlaylistCapability|userPlaylistByToken|myUserPlaylists|myUserPlaylist|userPlaylistReportQueue)",
    max: 60,
    window: "1m",
  },
  {
    type: "Mutation",
    field: "reportUserPlaylist",
    max: 10,
    window: "1m",
  },
  {
    type: "Mutation",
    field:
      "(createUserPlaylist|updateUserPlaylist|deleteUserPlaylist|unshareUserPlaylist|reshareUserPlaylist|rotateUserPlaylistCapability|blockUserPlaylist|restoreUserPlaylist)",
    max: 20,
    window: "1m",
  },
  {
    type: "Mutation",
    field:
      "!(reportUserPlaylist|createUserPlaylist|updateUserPlaylist|deleteUserPlaylist|unshareUserPlaylist|reshareUserPlaylist|rotateUserPlaylistCapability|blockUserPlaylist|restoreUserPlaylist)",
    max: 30,
    window: "1m",
  },
]

export const rateLimitPluginOptions = {
  identifyFn: (context: unknown) =>
    identifyForRateLimit(context as ContextShape),
  store: createRateLimitStore(),
  configByField: rateLimitConfigByField,
  enableBatchRequestCache: true,
}

export const rateLimitPlugin = useRateLimiter(rateLimitPluginOptions)

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

// GraphQL rate limiter — operation-scope, in-memory store.
//
// Keyed by user.id for authenticated callers, CF-Connecting-IP for
// unauthenticated. Each anonymous IP gets its own bucket so one
// attacker cannot exhaust the limit for all public users.
//
// Defaults: 60 queries/min authenticated, 30 mutations/min.
// Upgradeable to RedisStore when shared Redis client is extracted.

import { useRateLimiter, InMemoryStore } from "@envelop/rate-limiter"
import type { ContextShape } from "@/graphql/builder"

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
  store: new InMemoryStore(),
  configByField: [
    { type: "Query", field: "*", max: 60, window: "1m" },
    { type: "Mutation", field: "*", max: 30, window: "1m" },
  ],
})

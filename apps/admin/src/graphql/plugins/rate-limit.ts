// GraphQL rate limiter — operation-scope, in-memory store.
//
// One check per HTTP request (not per field). Keyed by user.id for
// authenticated callers, "public" for unauthenticated.
//
// Defaults: 60 queries/min, 30 mutations/min per identity.
// Upgradeable to RedisStore when shared Redis client is extracted.

import { useRateLimiter, InMemoryStore } from "@envelop/rate-limiter"
import type { ContextShape } from "@/graphql/builder"

export const rateLimitPlugin = useRateLimiter({
  identifyFn: (context) => {
    const ctx = context as ContextShape
    if (ctx.user?.id) return ctx.user.id
    return "public"
  },
  store: new InMemoryStore(),
  configByField: [
    { type: "Query", field: "*", max: 60, window: "1m" },
    { type: "Mutation", field: "*", max: 30, window: "1m" },
  ],
})

import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client"

import { env } from "@/env"

// 3 s end-to-end budget. Admin is internal-network from Railway, so a
// healthy SSR call returns in <500 ms; the budget exists to fail fast when
// the upstream is sick rather than pinning Next.js workers on stuck calls.
// Pattern: docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md
const REQUEST_TIMEOUT_MS = 3_000

const timeoutFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })

// Deferred construction: types in `content.ts` are imported transitively
// by a few `"use client"` renderers (e.g. `WatchSectionRenderer` needs
// the `isWatchBlock` type-guard alongside block types). Reading
// `env.WEB_ADMIN_API_KEYS` / `env.ADMIN_GRAPHQL_URL` at module-load
// trips t3-oss/env-nextjs's client guard the moment any such client
// chunk evaluates this file. A lazy singleton keeps module-load inert
// on the client; server callers still hit a single shared instance.
let realClient: ApolloClient | undefined

function ensureClient(): ApolloClient {
  if (realClient) return realClient
  // WEB_ADMIN_API_KEYS may be a single key or a CSV mirroring admin's
  // keyring. We read the first entry as our outbound bearer so traffic
  // identifies as `consumer:<key>` at admin's rate-limit layer rather
  // than `public:<railway-egress-ip>`.
  const bearer = env.WEB_ADMIN_API_KEYS.split(",")[0]?.trim() ?? ""
  realClient = new ApolloClient({
    link: new HttpLink({
      uri: env.ADMIN_GRAPHQL_URL,
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
      fetch: timeoutFetch,
    }),
    cache: new InMemoryCache(),
  })
  return realClient
}

const adminClient = new Proxy({} as ApolloClient, {
  get(_target, prop, receiver) {
    return Reflect.get(ensureClient(), prop, receiver)
  },
})

export default adminClient

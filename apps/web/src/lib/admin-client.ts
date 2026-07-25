import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client"

import { env } from "@/env"

// 15 s end-to-end budget. Healthy SSR calls return in <500 ms over Railway's
// internal network, but admin's `videoBySlug` resolver currently takes ~6 s
// for COLLECTION rows because of the `parents.parent.children.child` 2-deep
// fan-out in the WatchVideo fragment (observed 6.2 s on `easter` post-flip,
// 2026-05-14). The budget exists to fail fast when the upstream is sick
// rather than pinning Next.js workers on stuck calls; the size is sized to
// admin's worst-observed resolver latency plus headroom. Drop back toward
// 3 s once admin's resolver fan-out is trimmed.
// Pattern: docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md
const REQUEST_TIMEOUT_MS = 15_000
const SEMANTIC_SEARCH_REQUEST_TIMEOUT_MS = 45_000

function createTimeoutFetch(timeoutMs: number): typeof fetch {
  return (input, init) =>
    fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) })
}

// Deferred construction: types in `content.ts` are imported transitively
// by a few `"use client"` renderers (e.g. `WatchSectionRenderer` needs
// the `isWatchBlock` type-guard alongside block types). Reading
// `env.WEB_ADMIN_API_KEYS` / `env.ADMIN_GRAPHQL_URL` at module-load
// trips t3-oss/env-nextjs's client guard the moment any such client
// chunk evaluates this file. Lazy singletons keep module-load inert
// on the client; server callers still hit shared instances per timeout budget.
function createAdminClient(timeoutMs: number): ApolloClient {
  // WEB_ADMIN_API_KEYS may be a single key or a CSV mirroring admin's
  // keyring. We read the first entry as our outbound bearer so traffic
  // identifies as `consumer:<key>` at admin's rate-limit layer rather
  // than `public:<railway-egress-ip>`.
  const bearer = env.WEB_ADMIN_API_KEYS.split(",")[0]?.trim() ?? ""
  return new ApolloClient({
    link: new HttpLink({
      uri: env.ADMIN_GRAPHQL_URL,
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
      fetch: createTimeoutFetch(timeoutMs),
    }),
    cache: new InMemoryCache(),
  })
}

export function createUserAdminClient(
  accessToken: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
): ApolloClient {
  return new ApolloClient({
    link: new HttpLink({
      uri: env.ADMIN_GRAPHQL_URL,
      headers: { Authorization: `Bearer ${accessToken}` },
      fetch: createTimeoutFetch(timeoutMs),
    }),
    cache: new InMemoryCache(),
  })
}

function createLazyAdminClient(timeoutMs: number): ApolloClient {
  let realClient: ApolloClient | undefined

  function ensureClient(): ApolloClient {
    realClient ??= createAdminClient(timeoutMs)
    return realClient
  }

  return new Proxy({} as ApolloClient, {
    get(_target, prop, receiver) {
      return Reflect.get(ensureClient(), prop, receiver)
    },
  })
}

const adminClient = createLazyAdminClient(REQUEST_TIMEOUT_MS)

export const semanticSearchAdminClient = createLazyAdminClient(
  SEMANTIC_SEARCH_REQUEST_TIMEOUT_MS,
)

export default adminClient

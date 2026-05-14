import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client"

import { env } from "@/env"

// 3 s end-to-end budget. Admin is internal-network from Railway, so a
// healthy SSR call returns in <500 ms; the budget exists to fail fast when
// the upstream is sick rather than pinning Next.js workers on stuck calls.
// Pattern: docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md
const REQUEST_TIMEOUT_MS = 3_000

// Module-scope bearer cache. WEB_ADMIN_API_KEYS may be a single key or a
// CSV mirroring admin's keyring. We read the first entry as our outbound
// bearer so traffic identifies as `consumer:<key>` at admin's rate-limit
// layer rather than `public:<railway-egress-ip>`. Cached at module load to
// avoid re-parsing on every request.
const bearer = env.WEB_ADMIN_API_KEYS.split(",")[0]?.trim() ?? ""

const timeoutFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })

const adminClient = new ApolloClient({
  link: new HttpLink({
    uri: env.ADMIN_GRAPHQL_URL,
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
    fetch: timeoutFetch,
  }),
  cache: new InMemoryCache(),
})

export default adminClient

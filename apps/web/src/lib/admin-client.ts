import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client"
import { env } from "@/env"

// =============================================================================
// U5 (feat-104) — admin GraphQL Apollo client
//
// Server-only. Mirrors apps/web/src/lib/client.ts byte-for-byte except:
// (a) URL from env.ADMIN_GRAPHQL_URL, (b) anonymous (admin's PUBLIC scope
// is anonymous — no Bearer), (c) shorter 3 s timeout (origin R12).
//
// IMPORTANT: AbortSignal.timeout(REQUEST_TIMEOUT_MS) is constructed inside
// the timeoutFetch closure (per-call), NOT at module scope. Module-scope
// construction would share one signal across every admin request — the
// signal would fire 3 s after process boot and every subsequent fetch
// would land on an already-aborted signal. The verbatim safe pattern is
// `apps/web/src/lib/client.ts:20-21`.
//
// Retire alongside the rest of U5's scaffolding. See:
//   apps/web/src/lib/content-api-mode.ts (deletion checklist)
// =============================================================================

const ADMIN_REQUEST_TIMEOUT_MS = 3_000

const timeoutFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    signal: AbortSignal.timeout(ADMIN_REQUEST_TIMEOUT_MS),
  })

const adminClient = new ApolloClient({
  link: new HttpLink({
    uri: env.ADMIN_GRAPHQL_URL,
    fetch: timeoutFetch,
  }),
  cache: new InMemoryCache(),
})

export default adminClient

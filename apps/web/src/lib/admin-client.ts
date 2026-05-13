import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client"
import { env } from "@/env"

// =============================================================================
// U5 (feat-104) / U6 (plan-003 PR-B) — admin GraphQL Apollo client
//
// Server-only. Mirrors apps/web/src/lib/client.ts byte-for-byte except:
// (a) URL from env.ADMIN_GRAPHQL_URL, (b) Authorization: Bearer header
// derived from env.WEB_ADMIN_API_KEYS (first CSV entry) so admin can
// bucket SSR traffic as `consumer:<key>` rather than `public:<egress-ip>`,
// and (c) shorter 3 s timeout (origin R12).
//
// IMPORTANT: AbortSignal.timeout(REQUEST_TIMEOUT_MS) is constructed inside
// the timeoutFetch closure (per-call), NOT at module scope. Module-scope
// construction would share one signal across every admin request — the
// signal would fire 3 s after process boot and every subsequent fetch
// would land on an already-aborted signal. The verbatim safe pattern is
// `apps/web/src/lib/client.ts:20-21`.
//
// Bearer scrubbing (U6 / R11): the bearer is injected via a custom fetch
// override. Apollo Client v4's network-error surface (`networkError.cause`)
// can include the original Request — its headers are normally NOT echoed
// in stringified error output, but defense-in-depth: this module never
// logs the bearer itself, and the override constructs a fresh Headers
// instance per call so any caller-supplied Authorization (none today) is
// replaced rather than merged. Tests force a 500 + assert no log payload
// contains the bearer string.
//
// Retire alongside the rest of U5's scaffolding. See:
//   apps/web/src/lib/content-api-mode.ts (deletion checklist)
// =============================================================================

const ADMIN_REQUEST_TIMEOUT_MS = 3_000

// Module-scope: env.WEB_ADMIN_API_KEYS is server-only and does not change
// across the process lifetime. Reading it once at HttpLink construction
// avoids per-request env-proxy hits and makes the no-bearer code path
// (env unset) unambiguously a deploy-time choice — not a race.
const ADMIN_BEARER: string | undefined =
  typeof window === "undefined"
    ? env.WEB_ADMIN_API_KEYS?.split(",")[0]?.trim() || undefined
    : undefined

const timeoutFetch: typeof fetch = (input, init) => {
  const timeoutSignal = AbortSignal.timeout(ADMIN_REQUEST_TIMEOUT_MS)
  // Preserve any caller-supplied init.signal so external cancellation
  // (Apollo request cancellation, AbortController from a future caller)
  // still works alongside our 3 s timeout. AbortSignal.any() is Node 20.3+;
  // fall back to the timeout-only signal on older runtimes (current
  // behavior — no caller passes a signal today, so the fallback is safe).
  const signal =
    init?.signal && typeof AbortSignal.any === "function"
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal

  // Build a fresh Headers instance so we control exactly what's sent.
  // Apollo passes its own content-type/accept headers via init.headers —
  // copy them, then set Authorization if the bearer is configured.
  const headers = new Headers(init?.headers)
  if (ADMIN_BEARER) {
    headers.set("Authorization", `Bearer ${ADMIN_BEARER}`)
  }
  return fetch(input, { ...init, signal, headers })
}

// `env.ADMIN_GRAPHQL_URL` is server-only AND optional (so default
// `FORGE_CONTENT_API=strapi` mode doesn't require any new env var to be
// set in Railway). Mirror client.ts's `typeof window` guard so this
// module can be imported transitively by client components without
// throwing at module load. Empty-string fallback is reached when:
//   - We're on the client (admin client never invoked there anyway), OR
//   - We're on the server but ADMIN_GRAPHQL_URL is unset (operator
//     hasn't configured it yet — admin queries fail with a non-URL fetch
//     error, caught by fetchAdminSlugExperience and surfaced as a
//     forge.parity.harness_error subkind admin_fetch_error in the
//     parity log so the operator notices and configures the var).
const uri = typeof window === "undefined" ? (env.ADMIN_GRAPHQL_URL ?? "") : ""

const adminClient = new ApolloClient({
  link: new HttpLink({
    uri,
    fetch: timeoutFetch,
  }),
  cache: new InMemoryCache(),
})

export default adminClient

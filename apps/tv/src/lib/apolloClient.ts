import {
  ApolloClient,
  ApolloLink,
  HttpLink,
  InMemoryCache,
  Observable,
} from "@apollo/client"
import { ServerError } from "@apollo/client/errors"
import { RetryLink } from "@apollo/client/link/retry"
import { getMainDefinition } from "@apollo/client/utilities"
import { getGraphQLUrl, getApiToken } from "./config"
import { headersForOperation } from "./authHeaders"
import { getViewerId } from "./viewer-id"
import { datadogGraphqlHeaders, isDatadogProvisioned } from "./datadog"

const REQUEST_TIMEOUT_MS = 15_000

function requestAbortedError(): Error {
  const error = new Error("Request aborted")
  error.name = "AbortError"
  return error
}

export const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  if (init?.signal?.aborted) throw requestAbortedError()
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const abort = () => controller.abort()
  init?.signal?.addEventListener("abort", abort, { once: true })
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(id)
    init?.signal?.removeEventListener("abort", abort)
  }
}

// Spread-merge so header links compose: each rides over what prior links set.
function mergeContextHeaders(
  operation: ApolloLink.Operation,
  headers: Record<string, string>,
): void {
  if (Object.keys(headers).length === 0) return
  const prev = operation.getContext()
  operation.setContext({ headers: { ...(prev.headers ?? {}), ...headers } })
}

/**
 * The request chain minus transport (auth + Datadog attribution). Exported so
 * tests can prove the Search bearer survives the attribution merge (U3).
 */
export function createRequestChain(): ApolloLink {
  // Two disjoint allowlists, one selection point (`headersForOperation`):
  //
  //   FLEET token + x-viewer-id ride on the Search op — admin buckets a
  //     fleet key per device (consumer:<key>:v:<viewer_id>), and on other public
  //     ops the bearer would pool the whole fleet into one bucket.
  //   Recommendation lifecycle uses the FLEET bearer without x-viewer-id.
  //   USER access token rides ONLY on watch-event writes.
  //
  // The user token arrives through operation CONTEXT rather than being read
  // here, because obtaining it may require an async refresh and this link is
  // synchronous. The allowlist still lives in one place: a caller that sets
  // `userAccessToken` on an operation outside USER_TOKEN_OPERATIONS gets no
  // header, so context is a supply channel, never an override.
  const authLink = new ApolloLink((operation, forward) => {
    const { userAccessToken } = operation.getContext() as {
      userAccessToken?: string
    }
    mergeContextHeaders(
      operation,
      headersForOperation({
        operationName: operation.operationName,
        fleetToken: getApiToken(),
        userAccessToken,
        viewerId: getViewerId(),
      }),
    )
    return forward(operation)
  })

  // Datadog attribution rides every named op. RUM's XHR proxy strips these
  // post-init (pre-init they pass through; admin ignores unknown headers).
  const datadogLink = new ApolloLink((operation, forward) => {
    const def = getMainDefinition(operation.query)
    mergeContextHeaders(
      operation,
      datadogGraphqlHeaders(
        operation.operationName,
        def.kind === "OperationDefinition" ? def.operation : undefined,
      ),
    )
    return forward(operation)
  })

  // Unprovisioned builds skip the attribution link entirely (null-gate).
  return isDatadogProvisioned() ? authLink.concat(datadogLink) : authLink
}

/**
 * Bounded retry for transient transport failures. The living-room case this
 * exists for: a TV powered on at the wall reaches JS before Wi-Fi has
 * associated, so the very first query fails instantly with "Network request
 * failed" and — with no retry — the viewer lands on an error screen while the
 * network comes up healthy a second later.
 *
 * Retry only fetch network failures and HTTP 500/502/503/504. Permanent HTTP
 * failures (including rate limiting), malformed payloads and GraphQL errors
 * are not connectivity recovery. Respect the caller's cancellation throughout
 * backoff as well as during fetch.
 *
 * Two deliberate exclusions:
 *  - MUTATIONS are never retried. `RecordWatchEvent` / `UpsertMyWatchProgress`
 *    are writes; a duplicated write is a worse outcome than a failed one, and
 *    the transport cannot know whether the server already committed.
 *  - Our OWN timeout (`AbortError` from `fetchWithTimeout`) is never retried.
 *    That abort is a deliberate decision to stop waiting; retrying it stacks
 *    another REQUEST_TIMEOUT_MS onto a screen someone is sitting in front of.
 *
 * Connectivity awareness (NetInfo) is deliberately NOT added here: it is a new
 * native module, and the first-ever production build is the wrong moment to
 * widen the native surface. Revisit once a release build is proven.
 */
export function shouldRetryRequest(
  error: unknown,
  query: ApolloLink.Operation["query"],
): boolean {
  if (!error || typeof error !== "object") return false
  if ("name" in error && error.name === "AbortError") return false
  const definition = getMainDefinition(query)
  if (
    definition.kind !== "OperationDefinition" ||
    definition.operation !== "query"
  )
    return false
  if (ServerError.is(error))
    return [500, 502, 503, 504].includes(error.statusCode)
  // Fetch rejects network failures with TypeError, including React Native's
  // "Network request failed". Do not retry arbitrary application exceptions.
  return "name" in error && error.name === "TypeError"
}

// Own the entire request subscription, so cancelling during RetryLink's delay
// also tears down its timer instead of waiting for another fetch to notice it.
const cancellationLink = new ApolloLink(
  (operation, forward) =>
    new Observable((observer) => {
      const signal = operation.getContext().fetchOptions?.signal as
        | AbortSignal
        | undefined
      if (signal?.aborted) {
        observer.error(requestAbortedError())
        return
      }
      const abort = () => observer.error(requestAbortedError())
      signal?.addEventListener("abort", abort, { once: true })
      const request = forward(operation).subscribe({
        next: (value) => observer.next(value),
        error: (error) => observer.error(error),
        complete: () => observer.complete(),
      })
      if (signal?.aborted) request.unsubscribe()
      return () => {
        signal?.removeEventListener("abort", abort)
        request.unsubscribe()
      }
    }),
)

const retryLink = new RetryLink({
  delay: { initial: 400, max: 5_000, jitter: true },
  attempts: {
    max: 3,
    retryIf: (error, operation) => shouldRetryRequest(error, operation.query),
  },
})

let _client: ApolloClient | undefined

/** Lazy singleton Apollo Client. Never instantiate at module scope — crashes
 * imports when env vars are missing in CI. */
export function getApolloClient(): ApolloClient {
  if (_client) return _client

  const link = createRequestChain()
    .concat(cancellationLink)
    .concat(retryLink)
    .concat(
      new HttpLink({
        uri: getGraphQLUrl(),
        fetch: fetchWithTimeout,
      }),
    )

  _client = new ApolloClient({
    link,
    cache: new InMemoryCache(),
    defaultOptions: {
      watchQuery: {
        fetchPolicy: "cache-and-network",
      },
    },
  })

  return _client
}

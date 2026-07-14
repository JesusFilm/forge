import {
  ApolloClient,
  ApolloLink,
  HttpLink,
  InMemoryCache,
} from "@apollo/client"
import { getMainDefinition } from "@apollo/client/utilities"
import { getApiToken, getGraphQLUrl } from "./config"
import { authHeadersForOperation } from "./authHeaders"
import { getViewerId } from "./viewer-id"
import {
  datadogGraphqlHeaders,
  datadogLog,
  isDatadogProvisioned,
} from "./datadog"

const REQUEST_TIMEOUT_MS = 15_000

// Exported for the timeout-marker test.
export const fetchWithTimeout = (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const controller = new AbortController()
  const id = setTimeout(() => {
    // Mark the client's own 15s deadline distinctly from an upstream signal abort
    // or a true network failure (R12/AE3): RUM records an aborted resource either
    // way, so this marker is what lets the agent tell "client gave up" from
    // "admin is slow" when the RUM↔APM durations disagree.
    if (isDatadogProvisioned()) {
      datadogLog.warn("graphql.client_timeout_abort", {
        budget_ms: REQUEST_TIMEOUT_MS,
      })
    }
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  if (init?.signal) {
    init.signal.addEventListener("abort", () => controller.abort(), {
      once: true,
    })
  }

  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(id),
  )
}

// Spread-merge so header links compose: each rides over what prior links set.
// NEVER a header-replacing setContext — that would drop the Search bearer the
// authLink set (mobile PR #1226 precedent).
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
 * tests can prove the Search bearer survives the attribution merge (R9).
 */
export function createRequestChain(): ApolloLink {
  // Bearer + x-viewer-id ride ONLY on the Search op: admin buckets a fleet key
  // per device (consumer:<key>:v:<viewer_id> from x-viewer-id, else per IP).
  // On public ops the bearer would pool the whole fleet into one bucket.
  const authLink = new ApolloLink((operation, forward) => {
    mergeContextHeaders(
      operation,
      authHeadersForOperation(
        operation.operationName,
        getApiToken(),
        getViewerId(),
      ),
    )
    return forward(operation)
  })

  // Datadog op-name/type attribution rides every named op. RUM's XHR proxy maps
  // these onto the RUM resource, so trackResources attributes each GraphQL
  // resource by operation (path A content correlation — no resource attribute).
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

let _client: ApolloClient | undefined

/**
 * Lazy singleton Apollo Client.
 * Never instantiate at module scope — crashes imports when env vars are missing in CI.
 */
export function getApolloClient(): ApolloClient {
  if (_client) return _client

  const link = createRequestChain().concat(
    new HttpLink({
      uri: getGraphQLUrl(),
      fetch: fetchWithTimeout,
    }),
  )

  _client = new ApolloClient({
    link,
    cache: new InMemoryCache(),
  })

  return _client
}

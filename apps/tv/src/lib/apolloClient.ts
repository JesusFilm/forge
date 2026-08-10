import {
  ApolloClient,
  ApolloLink,
  HttpLink,
  InMemoryCache,
} from "@apollo/client"
import { getMainDefinition } from "@apollo/client/utilities"
import { getGraphQLUrl, getApiToken } from "./config"
import { headersForOperation } from "./authHeaders"
import { getViewerId } from "./viewer-id"
import { datadogGraphqlHeaders, isDatadogProvisioned } from "./datadog"

const REQUEST_TIMEOUT_MS = 15_000

const fetchWithTimeout = (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

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
  //   FLEET token + x-viewer-id ride ONLY on the Search op — admin buckets a
  //     fleet key per device (consumer:<key>:v:<viewer_id>), and on other public
  //     ops the bearer would pool the whole fleet into one bucket.
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

let _client: ApolloClient | undefined

/** Lazy singleton Apollo Client. Never instantiate at module scope — crashes
 * imports when env vars are missing in CI. */
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
    defaultOptions: {
      watchQuery: {
        fetchPolicy: "cache-and-network",
      },
    },
  })

  return _client
}

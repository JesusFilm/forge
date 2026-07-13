import {
  ApolloClient,
  ApolloLink,
  HttpLink,
  InMemoryCache,
} from "@apollo/client"
import { getApiToken, getGraphQLUrl } from "./config"
import { authHeadersForOperation } from "./authHeaders"
import { getViewerId } from "./viewer-id"

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

let _client: ApolloClient | undefined

/**
 * Lazy singleton Apollo Client.
 * Never instantiate at module scope — crashes imports when env vars are missing in CI.
 */
export function getApolloClient(): ApolloClient {
  if (_client) return _client

  // Bearer + x-viewer-id ride ONLY on the gated Search operation: admin buckets a
  // fleet key per device (consumer:<key>:v:<viewer_id> from x-viewer-id, else per
  // IP). On public ops the bearer would pool the whole fleet into one bucket.
  const authLink = new ApolloLink((operation, forward) => {
    const auth = authHeadersForOperation(
      operation.operationName,
      getApiToken(),
      getViewerId(),
    )
    if (Object.keys(auth).length > 0) {
      const prev = operation.getContext()
      operation.setContext({
        headers: { ...(prev.headers ?? {}), ...auth },
      })
    }
    return forward(operation)
  })

  const link = authLink.concat(
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

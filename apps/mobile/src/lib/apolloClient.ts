import {
  ApolloClient,
  ApolloLink,
  HttpLink,
  InMemoryCache,
} from "@apollo/client"
import { getApiToken, getGraphQLUrl } from "./config"
import { authHeadersForOperation } from "./authHeaders"

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

  // The bearer rides ONLY on the gated Search operation: a bearer'd request
  // rate-limit-buckets as consumer:<key> on admin (one shared bucket for the
  // whole fleet), while anonymous public queries bucket per device IP.
  const authLink = new ApolloLink((operation, forward) => {
    const auth = authHeadersForOperation(operation.operationName, getApiToken())
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

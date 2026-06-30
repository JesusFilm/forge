import {
  ApolloClient,
  ApolloLink,
  HttpLink,
  InMemoryCache,
} from "@apollo/client"
import { getGraphQLUrl, getApiToken } from "./config"
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

/** Lazy singleton Apollo Client. Never instantiate at module scope — crashes
 * imports when env vars are missing in CI. */
export function getApolloClient(): ApolloClient {
  if (_client) return _client

  // Bearer rides ONLY on the Search op: attaching it globally merges the fleet
  // into one consumer:<key> 60/min bucket (public ops bucket per device IP). Prod
  // token embargoed until admin lands fleet-aware bucketing (U7).
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
    defaultOptions: {
      watchQuery: {
        fetchPolicy: "cache-and-network",
      },
    },
  })

  return _client
}

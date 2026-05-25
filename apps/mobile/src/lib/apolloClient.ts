import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client"
import { getGraphQLUrl } from "./config"

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

  const link = new HttpLink({
    uri: getGraphQLUrl(),
    fetch: fetchWithTimeout,
  })

  _client = new ApolloClient({
    link,
    cache: new InMemoryCache(),
  })

  return _client
}

import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client"
import { config } from "./config"

const REQUEST_TIMEOUT_MS = 15_000

const fetchWithTimeout = (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  // Forward caller's abort signal (AbortSignal.any is unavailable in Hermes)
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

export function getApolloClient(): ApolloClient {
  if (!_client) {
    const uri = config.graphqlUrl
    const headers: Record<string, string> = {}
    if (config.strapiToken) {
      headers.Authorization = `Bearer ${config.strapiToken}`
    }
    const link = new HttpLink({ uri, headers, fetch: fetchWithTimeout })
    _client = new ApolloClient({ link, cache: new InMemoryCache() })
  }
  return _client
}

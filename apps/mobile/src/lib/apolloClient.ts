import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client"
import { config } from "./config"

const REQUEST_TIMEOUT_MS = 15_000

const fetchWithTimeout = (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const signal = init?.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal
  return fetch(input, { ...init, signal }).finally(() => clearTimeout(id))
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

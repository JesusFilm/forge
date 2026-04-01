import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { persistCache } from "apollo3-cache-persist"
import { getGraphQLUrl, getApiToken } from "./config"

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
let _initPromise: Promise<ApolloClient> | undefined

/**
 * Lazy singleton Apollo Client with persisted cache.
 * Never instantiate at module scope — crashes imports when env vars are missing in CI.
 */
export async function getApolloClient(): Promise<ApolloClient> {
  if (_client) return _client
  if (_initPromise) return _initPromise

  _initPromise = (async () => {
    const cache = new InMemoryCache()

    // Hydrate cache from AsyncStorage for instant cold-start rendering
    await persistCache({
      cache,
      storage: AsyncStorage,
    })

    const headers: Record<string, string> = {}
    const token = getApiToken()
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }

    const link = new HttpLink({
      uri: getGraphQLUrl(),
      headers,
      fetch: fetchWithTimeout,
    })

    _client = new ApolloClient({
      link,
      cache,
      defaultOptions: {
        watchQuery: { fetchPolicy: "cache-first" },
      },
    })

    return _client
  })()

  return _initPromise
}

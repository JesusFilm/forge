import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client"
import { config } from "./config"

const uri = config.graphqlUrl || "http://localhost:1337/graphql"
const headers: Record<string, string> = {}
if (config.strapiToken) {
  headers.Authorization = `Bearer ${config.strapiToken}`
}

const REQUEST_TIMEOUT_MS = 15_000

const fetchWithTimeout = (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(id),
  )
}

const link = new HttpLink({ uri, headers, fetch: fetchWithTimeout })

export const apolloClient = new ApolloClient({
  link,
  cache: new InMemoryCache(),
})

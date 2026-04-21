import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client"
import { env } from "@/env"

const isServer = typeof window === "undefined"
const uri = isServer ? env.INTERNAL_GRAPHQL_URL : env.NEXT_PUBLIC_GRAPHQL_URL
// Only attach the Strapi Bearer header when we actually have a token. An
// empty `Bearer ` header is rejected as malformed credentials by Strapi even
// for resolvers marked `auth: false`.
const headers: Record<string, string> =
  isServer && env.STRAPI_API_TOKEN
    ? { Authorization: `Bearer ${env.STRAPI_API_TOKEN}` }
    : {}

// 10 s end-to-end budget per GraphQL call. Default Node 18+/undici has no
// upper bound, which means a slow CMS pins Next.js RSC rendering until the
// platform's ~5 min header-idle timeout trips. Fail fast instead so a single
// flaky request doesn't drag the Railway worker pool.
const REQUEST_TIMEOUT_MS = 10_000

const timeoutFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })

const client = new ApolloClient({
  link: new HttpLink({ uri, headers, fetch: timeoutFetch }),
  cache: new InMemoryCache(),
})

export default client

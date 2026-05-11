import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client"
import { env } from "@/env"

const isServer = typeof window === "undefined"
const uri = isServer
  ? env.INTERNAL_ADMIN_GRAPHQL_URL
  : env.NEXT_PUBLIC_ADMIN_GRAPHQL_URL

// 10 s end-to-end budget per GraphQL call. Default Node 18+/undici has no
// upper bound, which means a slow API pins Next.js RSC rendering until the
// platform's ~5 min header-idle timeout trips. Fail fast instead so a single
// flaky request doesn't drag the Railway worker pool.
const REQUEST_TIMEOUT_MS = 10_000

const timeoutFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })

const client = new ApolloClient({
  link: new HttpLink({ uri, fetch: timeoutFetch }),
  cache: new InMemoryCache(),
})

export default client

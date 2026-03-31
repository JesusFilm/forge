import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client"
import { env } from "@/env"

const isServer = typeof window === "undefined"
const uri = isServer ? env.INTERNAL_GRAPHQL_URL : env.NEXT_PUBLIC_GRAPHQL_URL
const headers: Record<string, string> = isServer
  ? {
      Authorization: `Bearer ${env.STRAPI_API_TOKEN}`,
    }
  : {}

// In Next.js 16, fetch() defaults to no-store (uncached). Without explicit
// cache options, Apollo's HttpLink triggers dynamic rendering on every route.
// Pass next.revalidate so the Full Route Cache + ISR can work.
const nextCacheFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    next: { revalidate: 60 },
  })

const client = new ApolloClient({
  link: new HttpLink({
    uri,
    headers,
    ...(isServer && { fetch: nextCacheFetch }),
  }),
  cache: new InMemoryCache(),
})

export default client

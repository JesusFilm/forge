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
const client = new ApolloClient({
  link: new HttpLink({ uri, headers }),
  cache: new InMemoryCache(),
})

export default client

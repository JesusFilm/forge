import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client"
import { env } from "@/env"

const isServer = typeof window === "undefined"
const uri = isServer ? env.INTERNAL_GRAPHQL_URL : env.NEXT_PUBLIC_GRAPHQL_URL
const headers: Record<string, string> = isServer
  ? {
      Authorization: `Bearer ${env.STRAPI_API_TOKEN}`,
    }
  : {}
const client = new ApolloClient({
  link: new HttpLink({ uri, headers }),
  cache: new InMemoryCache(),
})

export default client

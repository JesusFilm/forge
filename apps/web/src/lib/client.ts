import "server-only"
import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client"
import { env } from "@/env"

const uri = env.NEXT_PUBLIC_GRAPHQL_URL ?? "http://localhost:1337/graphql"
const headers: Record<string, string> = {}
if (env.STRAPI_API_TOKEN) {
  headers.Authorization = `Bearer ${env.STRAPI_API_TOKEN}`
}
const client = new ApolloClient({
  link: new HttpLink({ uri, headers }),
  cache: new InMemoryCache(),
})

export default client

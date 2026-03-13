import "server-only"
import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client"
import { env } from "@/env"

const uri = env.NEXT_PUBLIC_GRAPHQL_URL
const headers: Record<string, string> = {
  Authorization: `Bearer ${env.STRAPI_API_TOKEN}`,
}
const client = new ApolloClient({
  link: new HttpLink({ uri, headers }),
  cache: new InMemoryCache(),
})

export default client

import "server-only"
import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client"
import { env } from "@/env"

const client = new ApolloClient({
  link: new HttpLink({
    uri: env.NEXT_PUBLIC_GRAPHQL_URL,
    headers: {
      Authorization: `Bearer ${env.STRAPI_API_TOKEN}`,
    },
  }),
  cache: new InMemoryCache(),
})

export default client

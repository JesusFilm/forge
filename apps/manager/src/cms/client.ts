// Apollo Client for Strapi GraphQL — same pattern as apps/web.
// Server-side only. Uses STRAPI_API_TOKEN for authentication.

import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client"
import { env } from "@/config/env"

let _client: ApolloClient<unknown> | undefined

export default function getClient(): ApolloClient<unknown> {
  if (!_client) {
    _client = new ApolloClient({
      link: new HttpLink({
        uri: `${env.STRAPI_URL}/graphql`,
        headers: {
          Authorization: `Bearer ${env.STRAPI_API_TOKEN}`,
        },
      }),
      cache: new InMemoryCache(),
    })
  }
  return _client
}

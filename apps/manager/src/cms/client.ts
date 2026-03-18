// Apollo Client for Strapi GraphQL — same pattern as apps/web.
// Server-side only. Uses STRAPI_API_TOKEN for authentication.
// TODO: Wire up with @forge/graphql typed operations for CMS sync

import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client"
import { env } from "@/config/env"

let _client: ApolloClient | undefined

export default function getClient(): ApolloClient {
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

import { ApolloClient, InMemoryCache, HttpLink } from "@apollo/client/core"

const CORE_SYNC_URL =
  process.env.CORE_SYNC_URL ?? "https://api-gateway.central.jesusfilm.org/"

let client: InstanceType<typeof ApolloClient> | undefined

export function getCoreClient() {
  if (!client) {
    client = new ApolloClient({
      link: new HttpLink({ uri: CORE_SYNC_URL, fetch }),
      cache: new InMemoryCache(),
      defaultOptions: {
        query: {
          fetchPolicy: "no-cache",
          errorPolicy: "all",
        },
      },
    })
  }
  return client
}

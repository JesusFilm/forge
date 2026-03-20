import { ApolloClient, InMemoryCache, HttpLink } from "@apollo/client/core"

const GATEWAY_URL =
  process.env.GATEWAY_SYNC_URL ?? "https://api-gateway.central.jesusfilm.org/"

let client: InstanceType<typeof ApolloClient> | undefined

export function getGatewayClient() {
  if (!client) {
    client = new ApolloClient({
      link: new HttpLink({ uri: GATEWAY_URL, fetch }),
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

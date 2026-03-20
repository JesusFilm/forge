import {
  ApolloClient,
  InMemoryCache,
  HttpLink,
  gql,
  type DocumentNode,
  type TypedDocumentNode,
} from "@apollo/client/core"

const GATEWAY_URL =
  process.env.GATEWAY_SYNC_URL ?? "https://api-gateway.central.jesusfilm.org/"

let client: InstanceType<typeof ApolloClient> | undefined

function getClient() {
  if (!client) {
    client = new ApolloClient({
      link: new HttpLink({ uri: GATEWAY_URL, fetch }),
      cache: new InMemoryCache(),
      defaultOptions: {
        query: {
          fetchPolicy: "no-cache",
          errorPolicy: "none",
        },
      },
    })
  }
  return client
}

/**
 * Query the gateway with a typed document node.
 * Usage: const { data } = await queryGateway(MY_QUERY, { limit: 10 })
 */
export async function queryGateway<
  TData,
  TVars extends Record<string, unknown> = Record<string, unknown>,
>(
  query: TypedDocumentNode<TData, TVars> | DocumentNode | string,
  variables?: TVars,
): Promise<TData> {
  const doc = typeof query === "string" ? gql(query) : query

  const queryName =
    doc.definitions?.[0]?.kind === "OperationDefinition"
      ? (doc.definitions[0].name?.value ?? "unknown")
      : "unknown"

  console.log(
    `[gateway-sync] Querying gateway: ${queryName}${variables ? ` ${JSON.stringify(variables)}` : ""}`,
  )

  const result = await getClient().query<TData>({
    query: doc,
    variables: variables as Record<string, unknown>,
  })

  if (result.error) {
    throw new Error(`Gateway GraphQL error: ${result.error.message}`)
  }

  if (!result.data) {
    throw new Error("Gateway returned no data")
  }

  return result.data
}

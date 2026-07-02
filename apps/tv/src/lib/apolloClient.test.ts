// Guards the U3 contract: the Datadog attribution merge must never clobber the
// SemanticSearch consumer bearer (see docs/solutions/architecture-patterns/
// fleet-client-bearer-must-be-operation-scoped-not-global.md).
jest.mock("../env", () => ({
  env: {
    EXPO_PUBLIC_GRAPHQL_URL: "https://admin.jesusfilm.org/api/graphql",
    EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN: "test-token",
    EXPO_PUBLIC_DATADOG_CLIENT_TOKEN: "ct",
    EXPO_PUBLIC_DATADOG_APPLICATION_ID: "app",
    EXPO_PUBLIC_DATADOG_SITE: undefined,
    EXPO_PUBLIC_DATADOG_ENV: undefined,
    EXPO_PUBLIC_DATADOG_VERSION: undefined,
  },
}))

jest.mock("@datadog/mobile-react-native", () => ({
  DdLogs: {
    info: jest.fn().mockResolvedValue(undefined),
    warn: jest.fn().mockResolvedValue(undefined),
    error: jest.fn().mockResolvedValue(undefined),
  },
  DdRum: {
    addError: jest.fn().mockResolvedValue(undefined),
    startView: jest.fn().mockResolvedValue(undefined),
    addTiming: jest.fn().mockResolvedValue(undefined),
  },
  ErrorSource: { SOURCE: "SOURCE" },
  PropagatorType: { TRACECONTEXT: "tracecontext" },
  DATADOG_GRAPH_QL_OPERATION_NAME_HEADER: "x-dd-graph-ql-operation-name",
  DATADOG_GRAPH_QL_OPERATION_TYPE_HEADER: "x-dd-graph-ql-operation-type",
}))

import {
  ApolloClient,
  ApolloLink,
  gql,
  InMemoryCache,
  Observable,
} from "@apollo/client"
import type { DocumentNode } from "graphql"
import { createRequestChain } from "./apolloClient"

// Terminating link captures the composed headers as the request reaches the
// transport slot; the chain runs synchronously so no network is involved.
function headersThroughChain(
  query: DocumentNode,
): Record<string, string> | undefined {
  let captured: Record<string, string> | undefined
  const terminal = new ApolloLink((operation) => {
    captured = operation.getContext().headers as Record<string, string>
    return new Observable<ApolloLink.Result>((subscriber) =>
      subscriber.complete(),
    )
  })
  const client = new ApolloClient({
    cache: new InMemoryCache(),
    link: ApolloLink.empty(),
  })
  ApolloLink.execute(
    createRequestChain().concat(terminal),
    { query },
    { client },
  ).subscribe({ error: () => undefined })
  return captured
}

describe("createRequestChain (auth + Datadog header composition)", () => {
  it("delivers the SemanticSearch bearer AND the attribution headers together", () => {
    const headers = headersThroughChain(gql`
      query SemanticSearch {
        __typename
      }
    `)
    expect(headers).toMatchObject({
      Authorization: "Bearer test-token",
      "x-dd-graph-ql-operation-name": "SemanticSearch",
      "x-dd-graph-ql-operation-type": "query",
    })
  })

  it("keeps public operations bearer-free while still attributing them", () => {
    const headers = headersThroughChain(gql`
      query GetSeriesBySlug {
        __typename
      }
    `)
    expect(headers?.Authorization).toBeUndefined()
    expect(headers?.["x-dd-graph-ql-operation-name"]).toBe("GetSeriesBySlug")
  })
})

// Guards the U3 contract: the Datadog attribution merge must never clobber the
// WatchSearch consumer bearer (see docs/solutions/architecture-patterns/
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
  context?: Record<string, unknown>,
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
    { query, context },
    { client },
  ).subscribe({ error: () => undefined })
  return captured
}

describe("createRequestChain (auth + Datadog header composition)", () => {
  it("delivers the WatchSearch bearer AND the attribution headers together", () => {
    const headers = headersThroughChain(gql`
      query WatchSearch {
        __typename
      }
    `)
    expect(headers).toMatchObject({
      Authorization: "Bearer test-token",
      "x-dd-graph-ql-operation-name": "WatchSearch",
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

/**
 * The user bearer, at the LINK rather than at `headersForOperation`.
 *
 * The allowlist is unit-tested one layer down, but the link is where a bypass
 * would actually be written — a stray `...(userAccessToken ? { Authorization }
 * : {})` spread next to the allowlist call compiles, type-checks, and attaches
 * a person's token to every operation the app makes. These cases fail if the
 * link ever stops treating context as a SUPPLY channel and lets it override.
 */
describe("createRequestChain (signed-in user bearer)", () => {
  const USER_TOKEN = "jfp_at_user_token"
  const withUser = { userAccessToken: USER_TOKEN }

  it("attaches the user token to the watch-event write", () => {
    const headers = headersThroughChain(
      gql`
        mutation RecordWatchEvent {
          __typename
        }
      `,
      withUser,
    )
    expect(headers?.Authorization).toBe(`Bearer ${USER_TOKEN}`)
  })

  it("NEVER attaches the user token to WatchSearch", () => {
    // Admin buckets rate limits by the credential presented. A user bearer here
    // moves the device out of its fleet bucket and changes the identity the
    // whole fleet is sized against — and it hands a person's token to an
    // operation that has no business seeing it.
    const headers = headersThroughChain(
      gql`
        query WatchSearch {
          __typename
        }
      `,
      withUser,
    )
    expect(headers?.Authorization).toBe("Bearer test-token")
    expect(headers?.Authorization).not.toContain(USER_TOKEN)
  })

  it("NEVER attaches the user token to an unlisted public operation", () => {
    const headers = headersThroughChain(
      gql`
        query GetSeriesBySlug {
          __typename
        }
      `,
      withUser,
    )
    expect(headers?.Authorization).toBeUndefined()
  })

  it("leaves the watch-event write anonymous when signed out", () => {
    // Signed out is a normal state: the flush retains the event rather than
    // writing it against nobody.
    const headers = headersThroughChain(gql`
      mutation RecordWatchEvent {
        __typename
      }
    `)
    expect(headers?.Authorization).toBeUndefined()
  })
})

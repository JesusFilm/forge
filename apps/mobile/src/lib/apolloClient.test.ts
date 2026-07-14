// Guards R9: the Datadog attribution merge must NEVER clobber the Search consumer
// bearer (see docs/solutions/architecture-patterns/
// fleet-client-bearer-must-be-operation-scoped-not-global.md / PR #1226).
jest.mock("../env", () => ({
  env: {
    EXPO_PUBLIC_ADMIN_GRAPHQL_URL: "https://admin.jesusfilm.org/api/graphql",
    EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN: "test-token",
    EXPO_PUBLIC_DATADOG_CLIENT_TOKEN: "ct",
    EXPO_PUBLIC_DATADOG_APPLICATION_ID: "app",
    EXPO_PUBLIC_DATADOG_SITE: undefined,
    EXPO_PUBLIC_DATADOG_ENV: undefined,
    EXPO_PUBLIC_DATADOG_VERSION: undefined,
    EXPO_PUBLIC_DATADOG_SESSION_SAMPLE_RATE: undefined,
    EXPO_PUBLIC_DATADOG_REPLAY_SAMPLE_RATE: undefined,
  },
  DEFAULT_ADMIN_GRAPHQL_URL: "https://admin.jesusfilm.org/api/graphql",
}))

jest.mock("./viewer-id", () => ({ getViewerId: () => "vid-123" }))

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
  RumActionType: { CUSTOM: "custom" },
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
import { DdLogs } from "@datadog/mobile-react-native"
import { env } from "../env"
import { createRequestChain, fetchWithTimeout } from "./apolloClient"

const mockEnv = env as unknown as Record<string, string | undefined>
const mockWarn = DdLogs.warn as jest.Mock

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

beforeEach(() => {
  mockEnv.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN = "ct"
  mockEnv.EXPO_PUBLIC_DATADOG_APPLICATION_ID = "app"
  jest.clearAllMocks()
  mockWarn.mockResolvedValue(undefined)
})

describe("createRequestChain (auth + Datadog header composition)", () => {
  it("delivers the Search bearer + viewer-id AND the attribution headers together", () => {
    const headers = headersThroughChain(gql`
      query Search {
        __typename
      }
    `)
    expect(headers).toMatchObject({
      Authorization: "Bearer test-token",
      "x-viewer-id": "vid-123",
      "x-dd-graph-ql-operation-name": "Search",
      "x-dd-graph-ql-operation-type": "query",
    })
  })

  it("keeps public operations bearer-free while still attributing them", () => {
    const headers = headersThroughChain(gql`
      query GetVideoBySlug {
        __typename
      }
    `)
    expect(headers?.Authorization).toBeUndefined()
    expect(headers?.["x-viewer-id"]).toBeUndefined()
    expect(headers?.["x-dd-graph-ql-operation-name"]).toBe("GetVideoBySlug")
  })

  it("skips the attribution link when unprovisioned, but keeps the Search bearer", () => {
    mockEnv.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN = undefined
    mockEnv.EXPO_PUBLIC_DATADOG_APPLICATION_ID = undefined
    const headers = headersThroughChain(gql`
      query Search {
        __typename
      }
    `)
    expect(headers?.Authorization).toBe("Bearer test-token")
    expect(headers?.["x-dd-graph-ql-operation-name"]).toBeUndefined()
  })
})

describe("fetchWithTimeout (client-timeout-abort marker, R12)", () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    jest.useRealTimers()
    globalThis.fetch = realFetch
  })

  it("emits the client_timeout_abort marker when the 15s deadline fires", () => {
    jest.useFakeTimers()
    // A never-resolving fetch so only the timeout can settle the abort path.
    globalThis.fetch = jest.fn(
      () => new Promise<Response>(() => {}),
    ) as unknown as typeof fetch
    void fetchWithTimeout("https://admin.jesusfilm.org/api/graphql")
    jest.advanceTimersByTime(15_000)
    expect(mockWarn).toHaveBeenCalledWith("graphql.client_timeout_abort", {
      budget_ms: 15_000,
    })
  })

  it("does not emit the marker on a normal (fast) settle", async () => {
    jest.useFakeTimers()
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true } as Response) as unknown as typeof fetch
    await fetchWithTimeout("https://admin.jesusfilm.org/api/graphql")
    jest.advanceTimersByTime(15_000)
    expect(mockWarn).not.toHaveBeenCalledWith(
      "graphql.client_timeout_abort",
      expect.anything(),
    )
  })
})

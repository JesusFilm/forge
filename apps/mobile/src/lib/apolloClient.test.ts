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
import { DdLogs, DdRum } from "@datadog/mobile-react-native"
import { CombinedGraphQLErrors } from "@apollo/client/errors"
import { env } from "../env"
import {
  createRequestChain,
  fetchWithTimeout,
  reportGraphqlOperationError,
} from "./apolloClient"

const mockEnv = env as unknown as Record<string, string | undefined>
const mockWarn = DdLogs.warn as jest.Mock
const mockAddError = DdRum.addError as jest.Mock

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
  mockAddError.mockResolvedValue(undefined)
})

describe("createRequestChain (auth + Datadog header composition)", () => {
  it("delivers the WatchSearch bearer + viewer-id AND the attribution headers together", () => {
    const headers = headersThroughChain(gql`
      query WatchSearch {
        __typename
      }
    `)
    expect(headers).toMatchObject({
      Authorization: "Bearer test-token",
      "x-viewer-id": "vid-123",
      "x-dd-graph-ql-operation-name": "WatchSearch",
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

  it("skips the attribution link when unprovisioned, but keeps the WatchSearch bearer", () => {
    mockEnv.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN = undefined
    mockEnv.EXPO_PUBLIC_DATADOG_APPLICATION_ID = undefined
    const headers = headersThroughChain(gql`
      query WatchSearch {
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
      operation: "anonymous",
    })
  })

  // feat-268: the marker must say WHICH operation blew the budget. One test
  // per header shape so each read branch is the only way to pass (META law).
  it("attributes the marker from a plain-object headers init", () => {
    jest.useFakeTimers()
    globalThis.fetch = jest.fn(
      () => new Promise<Response>(() => {}),
    ) as unknown as typeof fetch
    void fetchWithTimeout("https://admin.jesusfilm.org/api/graphql", {
      headers: { "x-dd-graph-ql-operation-name": "GetVideoBySlug" },
    })
    jest.advanceTimersByTime(15_000)
    expect(mockWarn).toHaveBeenCalledWith("graphql.client_timeout_abort", {
      budget_ms: 15_000,
      operation: "GetVideoBySlug",
    })
  })

  it("attributes the marker from a Headers-instance init (get() branch)", () => {
    jest.useFakeTimers()
    globalThis.fetch = jest.fn(
      () => new Promise<Response>(() => {}),
    ) as unknown as typeof fetch
    // get()-bearing shape: only the Headers-instance branch can read this —
    // there is no matching own-key for the plain-object scan to find.
    const headersInstance = {
      get: (name: string) =>
        name.toLowerCase() === "x-dd-graph-ql-operation-name" ? "Search" : null,
    }
    void fetchWithTimeout("https://admin.jesusfilm.org/api/graphql", {
      headers: headersInstance as unknown as Headers,
    })
    jest.advanceTimersByTime(15_000)
    expect(mockWarn).toHaveBeenCalledWith("graphql.client_timeout_abort", {
      budget_ms: 15_000,
      operation: "Search",
    })
  })

  it("degrades to 'anonymous' when the header read throws", () => {
    jest.useFakeTimers()
    globalThis.fetch = jest.fn(
      () => new Promise<Response>(() => {}),
    ) as unknown as typeof fetch
    const hostileHeaders = {
      get: () => {
        throw new Error("exotic headers shape")
      },
    }
    void fetchWithTimeout("https://admin.jesusfilm.org/api/graphql", {
      headers: hostileHeaders as unknown as Headers,
    })
    jest.advanceTimersByTime(15_000)
    expect(mockWarn).toHaveBeenCalledWith("graphql.client_timeout_abort", {
      budget_ms: 15_000,
      operation: "anonymous",
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

describe("reportGraphqlOperationError (HTTP-200 GraphQL + network errors, R13)", () => {
  it("reports a GraphQL-in-200 error keyed by operation + code", () => {
    const err = new CombinedGraphQLErrors({
      errors: [
        { message: "rate limited", extensions: { code: "RATE_LIMITED" } },
      ],
    })
    reportGraphqlOperationError(err, "Search")
    expect(mockAddError).toHaveBeenCalledWith(
      expect.any(String),
      "SOURCE",
      expect.any(String),
      { origin: "graphql_error", operation: "Search", code: "RATE_LIMITED" },
    )
  })

  it("falls back to 'unknown' code when the error has no extensions.code", () => {
    const err = new CombinedGraphQLErrors({ errors: [{ message: "boom" }] })
    reportGraphqlOperationError(err, "GetVideoBySlug")
    expect(mockAddError).toHaveBeenCalledWith(
      expect.any(String),
      "SOURCE",
      expect.any(String),
      { origin: "graphql_error", operation: "GetVideoBySlug", code: "unknown" },
    )
  })

  it("reports a network error under the network origin", () => {
    reportGraphqlOperationError(
      new Error("socket hang up"),
      "GetWatchHomeVideos",
    )
    expect(mockAddError).toHaveBeenCalledWith(
      "socket hang up",
      "SOURCE",
      expect.any(String),
      { origin: "graphql_network_error", operation: "GetWatchHomeVideos" },
    )
  })

  it("no-ops when unprovisioned", () => {
    mockEnv.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN = undefined
    mockEnv.EXPO_PUBLIC_DATADOG_APPLICATION_ID = undefined
    reportGraphqlOperationError(new Error("x"), "Search")
    expect(mockAddError).not.toHaveBeenCalled()
  })

  // Client-initiated aborts (15s fetchWithTimeout, unmount/supersede teardown)
  // are noise, not failures — 390 "Aborted" RUM errors in one week of dev/preview
  // sessions. The timeout case already has its own Logs marker (R12).
  it("skips the real RN abort shape (DOMException('Aborted', 'AbortError'))", () => {
    const abort = new Error("Aborted")
    abort.name = "AbortError"
    reportGraphqlOperationError(abort, "GetVideoBySlug")
    expect(mockAddError).not.toHaveBeenCalled()
  })

  // Isolates the name branch: message wording drift must not defeat the skip.
  it("skips an abort by name alone, regardless of message wording", () => {
    const abort = new Error("The operation was aborted")
    abort.name = "AbortError"
    reportGraphqlOperationError(abort, "GetVideoBySlug")
    expect(mockAddError).not.toHaveBeenCalled()
  })

  // Message text alone never suppresses (AWS-NoSuchKey classification law):
  // no real RN abort lacks the AbortError name, so this shape is a genuine error.
  it("still reports a message-only 'Aborted' error (no AbortError name)", () => {
    reportGraphqlOperationError(new Error("Aborted"), "GetVideoBySlug")
    expect(mockAddError).toHaveBeenCalledWith(
      "Aborted",
      "SOURCE",
      expect.any(String),
      { origin: "graphql_network_error", operation: "GetVideoBySlug" },
    )
  })

  // Guard-vs-typed-branch precedence: a server error whose message collides
  // with the abort sentinel must still report through the GraphQL branch.
  it("still reports a CombinedGraphQLErrors whose message is exactly 'Aborted'", () => {
    const err = new CombinedGraphQLErrors({ errors: [{ message: "Aborted" }] })
    reportGraphqlOperationError(err, "Search")
    expect(mockAddError).toHaveBeenCalledWith(
      expect.any(String),
      "SOURCE",
      expect.any(String),
      { origin: "graphql_error", operation: "Search", code: "unknown" },
    )
  })

  it("still reports RN's real network-failure shape (TypeError)", () => {
    reportGraphqlOperationError(
      new TypeError("Network request failed"),
      "GetWatchHomeVideos",
    )
    expect(mockAddError).toHaveBeenCalledWith(
      "Network request failed",
      "SOURCE",
      expect.any(String),
      { origin: "graphql_network_error", operation: "GetWatchHomeVideos" },
    )
  })

  // KTD6 exemption: anonymous event mutations accept per-IP rate shedding, so a
  // shed RecordWatchSearchEvent must not file a RUM error. One test per error
  // shape — a shed arrives as GraphQL-in-200 RATE_LIMITED, a drop as a network
  // error — and the "still reports" cases above are the anti-vacuous contrast.
  it("skips the exempted event op on the GraphQL-in-200 branch (rate shed)", () => {
    const err = new CombinedGraphQLErrors({
      errors: [
        { message: "rate limited", extensions: { code: "RATE_LIMITED" } },
      ],
    })
    reportGraphqlOperationError(err, "RecordWatchSearchEvent")
    expect(mockAddError).not.toHaveBeenCalled()
  })

  it("skips the exempted event op on the network-error branch", () => {
    reportGraphqlOperationError(
      new Error("socket hang up"),
      "RecordWatchSearchEvent",
    )
    expect(mockAddError).not.toHaveBeenCalled()
  })
})

import { CombinedGraphQLErrors } from "@apollo/client/errors"
import {
  WATCH_SEARCH_LOG_MESSAGE,
  buildWatchSearchLogAttributes,
  generateSearchRequestId,
  parseSearchErrorCode,
  resolveWatchSearchOutcome,
} from "./watchSearchLog"

// A real Apollo v4 error, the shape client.query() actually throws — NOT a
// hand-shaped { graphQLErrors } (v3), which never occurs against this client.
const combinedError = (code?: string) =>
  new CombinedGraphQLErrors({
    errors: [{ message: "boom", extensions: code ? { code } : undefined }],
  })

const V4_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

// Admin's request-id validator; ids outside this shape are dropped server-side.
const ADMIN_REQUEST_ID = /^[A-Za-z0-9_-]{8,80}$/

describe("generateSearchRequestId", () => {
  it("returns a distinct v4 uuid on each call", () => {
    const a = generateSearchRequestId()
    const b = generateSearchRequestId()
    expect(a).not.toBe(b)
    expect(a).toMatch(V4_UUID)
    expect(b).toMatch(V4_UUID)
  })

  it("satisfies admin's request-id pattern", () => {
    expect(generateSearchRequestId()).toMatch(ADMIN_REQUEST_ID)
  })

  it("still returns a v4-shaped id when crypto.randomUUID is absent (Hermes)", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto")
    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      configurable: true,
      writable: true,
    })
    try {
      const id = generateSearchRequestId()
      expect(id).toMatch(V4_UUID)
      expect(id).toMatch(ADMIN_REQUEST_ID)
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor)
      else delete (globalThis as { crypto?: unknown }).crypto
    }
  })
})

describe("parseSearchErrorCode", () => {
  it("extracts the GraphQL error code from a rate-limit rejection", () => {
    expect(parseSearchErrorCode(combinedError("RATE_LIMITED"))).toBe(
      "RATE_LIMITED",
    )
  })

  it("falls back to 'unknown' for a network error or a code-less GraphQL error", () => {
    expect(parseSearchErrorCode(new Error("network"))).toBe("unknown")
    expect(parseSearchErrorCode(null)).toBe("unknown")
    expect(parseSearchErrorCode(combinedError())).toBe("unknown")
  })
})

// Web's outcome vocabulary (apps/web watch-search-analytics.ts) — the old
// results|empty|error values landed in mobile-only Datadog facet buckets.
describe("resolveWatchSearchOutcome", () => {
  it("maps a non-empty result set to 'completed' with the count", () => {
    expect(resolveWatchSearchOutcome({ results: [1, 2, 3] })).toEqual({
      outcome: "completed",
      result_count: 3,
    })
  })

  it("maps an empty or nullish result set to 'no_result'", () => {
    expect(resolveWatchSearchOutcome({ results: [] })).toEqual({
      outcome: "no_result",
      result_count: 0,
    })
    expect(resolveWatchSearchOutcome({ results: null })).toEqual({
      outcome: "no_result",
      result_count: 0,
    })
  })

  it("maps an error to 'failed' with the parsed code and a zero count", () => {
    expect(
      resolveWatchSearchOutcome({
        results: null,
        error: combinedError("UNAUTHENTICATED"),
      }),
    ).toEqual({ outcome: "failed", result_count: 0, code: "UNAUTHENTICATED" })
  })

  it("prefers the failed branch even when results are present", () => {
    expect(
      resolveWatchSearchOutcome({
        results: [1, 2],
        error: new Error("boom"),
      }),
    ).toEqual({ outcome: "failed", result_count: 0, code: "unknown" })
  })
})

// The exact key sets below are the cross-client contract (web/TV join on the
// shared message + watch_search.* facets); toEqual pins them whole — an added
// or leaked key fails, not just a missing one.
describe("buildWatchSearchLogAttributes", () => {
  const baseInput = {
    searchRequestId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    query: "jesus",
    offset: 0,
    clientLatencyMs: 320,
  } as const

  it("emits under the exact shared message web and TV use", () => {
    expect(WATCH_SEARCH_LOG_MESSAGE).toBe("watch_search analytics")
  })

  it("builds the exact success bag for a search, all response scalars present", () => {
    expect(
      buildWatchSearchLogAttributes({
        ...baseInput,
        requestType: "search",
        outcome: { outcome: "completed", result_count: 12 },
        latencyMs: 210,
        degraded: false,
        responseSearchMode: "AGENTIC",
      }),
    ).toEqual({
      "watch_search.event_name": "watch_search",
      "watch_search.exact_query_included": true,
      "watch_search.outcome": "completed",
      "watch_search.request_type": "search",
      "watch_search.search_request_id": "0f8fad5b-d9cb-469f-a165-70867728950e",
      "watch_search.query": "jesus",
      "watch_search.result_count": 12,
      "watch_search.visible_result_count": 12,
      "watch_search.client_latency_ms": 320,
      "watch_search.search_language_slug": "english",
      "watch_search.offset": 0,
      "watch_search.latency_ms": 210,
      "watch_search.degraded": false,
      "watch_search.response_search_mode": "AGENTIC",
    })
  })

  it("omits latency_ms, degraded and response_search_mode when the response lacks them", () => {
    expect(
      buildWatchSearchLogAttributes({
        ...baseInput,
        requestType: "search",
        outcome: { outcome: "no_result", result_count: 0 },
        latencyMs: null,
        degraded: null,
        responseSearchMode: null,
      }),
    ).toEqual({
      "watch_search.event_name": "watch_search",
      "watch_search.exact_query_included": true,
      "watch_search.outcome": "no_result",
      "watch_search.request_type": "search",
      "watch_search.search_request_id": "0f8fad5b-d9cb-469f-a165-70867728950e",
      "watch_search.query": "jesus",
      "watch_search.result_count": 0,
      "watch_search.visible_result_count": 0,
      "watch_search.client_latency_ms": 320,
      "watch_search.search_language_slug": "english",
      "watch_search.offset": 0,
    })
  })

  it("adds added_result_count only on load_more, with visible = prior + appended", () => {
    const searchBag = buildWatchSearchLogAttributes({
      ...baseInput,
      requestType: "search",
      outcome: { outcome: "completed", result_count: 12 },
    })
    expect(searchBag).not.toHaveProperty("watch_search.added_result_count")

    const loadMoreBag = buildWatchSearchLogAttributes({
      ...baseInput,
      offset: 20,
      requestType: "load_more",
      priorVisibleCount: 20,
      outcome: { outcome: "completed", result_count: 10 },
    })
    expect(loadMoreBag["watch_search.request_type"]).toBe("load_more")
    expect(loadMoreBag["watch_search.added_result_count"]).toBe(10)
    expect(loadMoreBag["watch_search.visible_result_count"]).toBe(30)
    expect(loadMoreBag["watch_search.result_count"]).toBe(10)
    expect(loadMoreBag["watch_search.offset"]).toBe(20)
  })

  it("prefixes every emitted key with watch_search.", () => {
    const bags = [
      buildWatchSearchLogAttributes({
        ...baseInput,
        requestType: "load_more",
        priorVisibleCount: 5,
        outcome: { outcome: "completed", result_count: 3 },
        latencyMs: 44,
        degraded: true,
        responseSearchMode: "SEMANTIC",
      }),
      buildWatchSearchLogAttributes({
        ...baseInput,
        requestType: "search",
        outcome: { outcome: "failed", result_count: 0, code: "http_429" },
      }),
    ]
    for (const bag of bags) {
      for (const key of Object.keys(bag)) {
        expect(key).toMatch(/^watch_search\./)
      }
    }
  })

  it("builds the exact failure bag: failure keys in, every response scalar out", () => {
    expect(
      buildWatchSearchLogAttributes({
        ...baseInput,
        clientLatencyMs: 950,
        requestType: "search",
        outcome: { outcome: "failed", result_count: 0, code: "http_429" },
        // A failure has no response; even wrongly-provided scalars must drop.
        latencyMs: 123,
        degraded: true,
        responseSearchMode: "SEMANTIC",
      }),
    ).toEqual({
      "watch_search.event_name": "watch_search",
      "watch_search.exact_query_included": true,
      "watch_search.outcome": "failed",
      "watch_search.request_type": "search",
      "watch_search.search_request_id": "0f8fad5b-d9cb-469f-a165-70867728950e",
      "watch_search.query": "jesus",
      "watch_search.result_count": 0,
      "watch_search.visible_result_count": 0,
      "watch_search.client_latency_ms": 950,
      "watch_search.search_language_slug": "english",
      "watch_search.offset": 0,
      "watch_search.failure_category": "watch_search_error",
      "watch_search.error_code": "http_429",
    })
  })

  it("builds the exact failure bag on load_more: nothing appended, prior stays visible", () => {
    expect(
      buildWatchSearchLogAttributes({
        ...baseInput,
        offset: 20,
        requestType: "load_more",
        priorVisibleCount: 20,
        outcome: { outcome: "failed", result_count: 0, code: "unknown" },
      }),
    ).toEqual({
      "watch_search.event_name": "watch_search",
      "watch_search.exact_query_included": true,
      "watch_search.outcome": "failed",
      "watch_search.request_type": "load_more",
      "watch_search.search_request_id": "0f8fad5b-d9cb-469f-a165-70867728950e",
      "watch_search.query": "jesus",
      "watch_search.result_count": 0,
      "watch_search.added_result_count": 0,
      "watch_search.visible_result_count": 20,
      "watch_search.client_latency_ms": 320,
      "watch_search.search_language_slug": "english",
      "watch_search.offset": 20,
      "watch_search.failure_category": "watch_search_error",
      "watch_search.error_code": "unknown",
    })
  })

  it("caps the raw query at web's 200-char bound and clamps negatives to 0", () => {
    const bag = buildWatchSearchLogAttributes({
      ...baseInput,
      query: "j".repeat(300),
      offset: -3,
      clientLatencyMs: -50,
      requestType: "search",
      outcome: { outcome: "completed", result_count: 1 },
    })
    expect(bag["watch_search.query"]).toBe("j".repeat(200))
    expect(bag["watch_search.offset"]).toBe(0)
    expect(bag["watch_search.client_latency_ms"]).toBe(0)
  })
})

// The rate limiter stamps http.statusCode and sets no domain code, so reading
// only `extensions.code` reported "unknown" for exactly the throttling that
// matters most operationally.
describe("parseSearchErrorCode falls back to the HTTP status", () => {
  it("reports a rate-limit 429 instead of unknown", () => {
    expect(
      parseSearchErrorCode(
        new CombinedGraphQLErrors({
          errors: [
            {
              message: "rate limited",
              extensions: { http: { statusCode: 429 } },
            },
          ],
        }),
      ),
    ).toBe("http_429")
  })

  it("still prefers an explicit code when admin sends one", () => {
    expect(
      parseSearchErrorCode(
        new CombinedGraphQLErrors({
          errors: [
            { message: "x", extensions: { code: "INTERNAL_SERVER_ERROR" } },
          ],
        }),
      ),
    ).toBe("INTERNAL_SERVER_ERROR")
  })
})

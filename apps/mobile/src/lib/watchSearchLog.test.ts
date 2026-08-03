import { CombinedGraphQLErrors } from "@apollo/client/errors"
import {
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

describe("resolveWatchSearchOutcome", () => {
  it("maps a non-empty result set to 'results' with the count", () => {
    expect(
      resolveWatchSearchOutcome({ term: "jesus", results: [1, 2, 3] }),
    ).toEqual({ outcome: "results", result_count: 3 })
  })

  it("maps an empty or nullish result set to 'empty'", () => {
    expect(resolveWatchSearchOutcome({ term: "zzz", results: [] })).toEqual({
      outcome: "empty",
      result_count: 0,
    })
    expect(resolveWatchSearchOutcome({ term: "zzz", results: null })).toEqual({
      outcome: "empty",
      result_count: 0,
    })
  })

  it("maps an error to 'error' with the parsed code and a zero count", () => {
    expect(
      resolveWatchSearchOutcome({
        term: "jesus",
        results: null,
        error: combinedError("UNAUTHENTICATED"),
      }),
    ).toEqual({ outcome: "error", result_count: 0, code: "UNAUTHENTICATED" })
  })

  it("prefers the error branch even when results are present", () => {
    expect(
      resolveWatchSearchOutcome({
        term: "jesus",
        results: [1, 2],
        error: new Error("boom"),
      }),
    ).toEqual({ outcome: "error", result_count: 0, code: "unknown" })
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

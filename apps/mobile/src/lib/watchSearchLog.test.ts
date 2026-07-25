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

describe("generateSearchRequestId", () => {
  it("returns a distinct, monotonic id on each call", () => {
    const a = generateSearchRequestId()
    const b = generateSearchRequestId()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^search-\d+$/)
    expect(b).toMatch(/^search-\d+$/)
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

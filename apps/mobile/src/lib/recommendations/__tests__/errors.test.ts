import { CombinedGraphQLErrors, ServerError } from "@apollo/client/errors"

import {
  RATE_LIMIT_WINDOW_MS,
  RecommendationClientError,
  parseRetryAfterMs,
  rateLimitDelayMs,
  toRecommendationClientError,
} from "../errors"

function graphqlError(code?: string, extra: Record<string, unknown> = {}) {
  return new CombinedGraphQLErrors({
    errors: [
      {
        message: "boom",
        extensions: code ? { code, ...extra } : undefined,
      },
    ],
  })
}

/** Admin's limiter: HTTP 200, one error, no `code`, only the http extension. */
function rateLimited(headers?: Record<string, unknown>) {
  return new CombinedGraphQLErrors({
    errors: [
      {
        message: "Too many calls",
        extensions: {
          http: { statusCode: 429, ...(headers ? { headers } : {}) },
        },
      },
    ],
  })
}

describe("toRecommendationClientError", () => {
  it.each([
    ["UNAUTHENTICATED", true],
    ["BAD_USER_INPUT", true],
    ["CONFLICT", true],
    ["SERVICE_UNAVAILABLE", false],
  ] as const)("maps Admin's %s code (definitive=%s)", (code, definitive) => {
    const failure = toRecommendationClientError(graphqlError(code))
    expect(failure).toBeInstanceOf(RecommendationClientError)
    expect(failure.code).toBe(code)
    expect(failure.definitive).toBe(definitive)
  })

  it("treats an unknown GraphQL code as definitive: replaying cannot help", () => {
    const failure = toRecommendationClientError(graphqlError("SOMETHING_NEW"))
    expect(failure.code).toBe("GRAPHQL_ERROR")
    expect(failure.definitive).toBe(true)
    expect(toRecommendationClientError(graphqlError()).code).toBe(
      "GRAPHQL_ERROR",
    )
  })

  // @envelop/rate-limiter 10.0.1 emits `extensions.http.statusCode` (no
  // `code`), and graphql-yoga 5.21 reads `extensions.http.status`, so Admin
  // answers HTTP 200 with the limiter's error in `errors[]`.
  it("classifies Admin's rate limiter answer as transient RATE_LIMITED with its window", () => {
    const failure = toRecommendationClientError(
      rateLimited({ "Retry-After": "1m" }),
    )
    expect(failure.code).toBe("RATE_LIMITED")
    expect(failure.definitive).toBe(false)
    expect(failure.retryAfterMs).toBe(60_000)
    expect(toRecommendationClientError(rateLimited()).retryAfterMs).toBeNull()
  })

  it("classifies an edge HTTP 429 the same way", () => {
    const response = {
      status: 429,
      headers: {
        get: (name: string) => (name === "retry-after" ? "30" : null),
      },
    }
    const failure = toRecommendationClientError(
      new ServerError("429", { response: response as never, bodyText: "" }),
    )
    expect(failure.code).toBe("RATE_LIMITED")
    expect(failure.retryAfterMs).toBe(30_000)
    const other = new ServerError("500", {
      response: { status: 500, headers: { get: () => null } } as never,
      bodyText: "",
    })
    expect(toRecommendationClientError(other).code).toBe("NETWORK_ERROR")
  })

  it("classifies an abort wrapped in a cause chain as a TIMEOUT", () => {
    const inner = Object.assign(new Error("Aborted"), { isClientAbort: true })
    const wrapped = Object.assign(new Error("wrapped"), { cause: inner })
    expect(toRecommendationClientError(wrapped).code).toBe("TIMEOUT")
  })

  it("threads Admin's finer binding code through", () => {
    const failure = toRecommendationClientError(
      graphqlError("CONFLICT", {
        recommendationCode: "playback_binding_invalid",
      }),
    )
    expect(failure.recommendationCode).toBe("playback_binding_invalid")
  })

  it("classifies the client's own abort as a transient TIMEOUT", () => {
    const abort = Object.assign(new Error("Aborted"), { isClientAbort: true })
    const failure = toRecommendationClientError(abort)
    expect(failure.code).toBe("TIMEOUT")
    expect(failure.definitive).toBe(false)
    const named = Object.assign(new Error("x"), { name: "AbortError" })
    expect(toRecommendationClientError(named).code).toBe("TIMEOUT")
  })

  it("classifies anything else as a transient network error", () => {
    const failure = toRecommendationClientError(
      new TypeError("Network request failed"),
    )
    expect(failure.code).toBe("NETWORK_ERROR")
    expect(failure.definitive).toBe(false)
    expect(failure.cause).toBeInstanceOf(TypeError)
  })

  it("passes an already-classified failure through unchanged", () => {
    const original = new RecommendationClientError("CONFLICT")
    expect(toRecommendationClientError(original)).toBe(original)
  })
})

describe("parseRetryAfterMs", () => {
  it.each([
    ["30", 30_000],
    [30, 30_000],
    ["1m", 60_000],
    ["500ms", 500],
    ["2h", 7_200_000],
    [" 45s ", 45_000],
    ["soon", null],
    ["-1", null],
    [undefined, null],
    [Number.NaN, null],
  ])("reads %p as %p", (value, expected) => {
    expect(parseRetryAfterMs(value)).toBe(expected)
  })
})

describe("rateLimitDelayMs", () => {
  it("honours the limiter's ask but never waits past the bucket window", () => {
    const asked = new RecommendationClientError("RATE_LIMITED", {
      retryAfterMs: 30_000,
    })
    expect(rateLimitDelayMs(asked)).toBe(30_000)
    const silent = new RecommendationClientError("RATE_LIMITED")
    expect(rateLimitDelayMs(silent)).toBe(RATE_LIMIT_WINDOW_MS)
    const long = new RecommendationClientError("RATE_LIMITED", {
      retryAfterMs: 5 * RATE_LIMIT_WINDOW_MS,
    })
    expect(rateLimitDelayMs(long)).toBe(RATE_LIMIT_WINDOW_MS)
  })
})

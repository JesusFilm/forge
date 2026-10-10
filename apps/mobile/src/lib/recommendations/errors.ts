/**
 * One failure shape for every recommendation call. Admin answers with a small
 * public-safe set of GraphQL codes; anything else is transport. `definitive`
 * decides retry: a definitive failure cannot improve by replaying the same
 * request, so callers drop it instead of retrying.
 */
import { CombinedGraphQLErrors, ServerError } from "@apollo/client/errors"

import { isClientAbortError } from "../clientAbortError"

export type RecommendationFailureCode =
  | "UNAUTHENTICATED"
  | "BAD_USER_INPUT"
  | "CONFLICT"
  | "SERVICE_UNAVAILABLE"
  | "RATE_LIMITED"
  | "GRAPHQL_ERROR"
  | "TIMEOUT"
  | "NETWORK_ERROR"

const DEFINITIVE_CODES: ReadonlySet<RecommendationFailureCode> = new Set([
  "UNAUTHENTICATED",
  "BAD_USER_INPUT",
  "CONFLICT",
  "GRAPHQL_ERROR",
])

/** Admin's mutation bucket is 30 per minute; a limited answer clears in that window. */
export const RATE_LIMIT_WINDOW_MS = 60_000

export class RecommendationClientError extends Error {
  readonly code: RecommendationFailureCode
  readonly definitive: boolean
  /** Admin's finer binding code when it sends one (`recommendationCode`). */
  readonly recommendationCode: string | null
  /** For RATE_LIMITED: how long the limiter asked the client to wait. */
  readonly retryAfterMs: number | null

  constructor(
    code: RecommendationFailureCode,
    options: {
      recommendationCode?: string | null
      retryAfterMs?: number | null
      cause?: unknown
    } = {},
  ) {
    super(`recommendation_${code.toLowerCase()}`)
    this.name = "RecommendationClientError"
    this.code = code
    this.definitive = DEFINITIVE_CODES.has(code)
    this.recommendationCode = options.recommendationCode ?? null
    this.retryAfterMs = options.retryAfterMs ?? null
    this.cause = options.cause
  }
}

const DURATION_UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
}

/**
 * A `Retry-After` value as milliseconds: HTTP's integer seconds, or the
 * `@envelop/rate-limiter` window string ("1m", "30s"). Null when unreadable.
 */
export function parseRetryAfterMs(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value * 1_000 : null
  }
  if (typeof value !== "string") return null
  const match = /^\s*(\d+)\s*(ms|s|m|h)?\s*$/i.exec(value)
  if (!match) return null
  const unit = DURATION_UNIT_MS[(match[2] ?? "s").toLowerCase()]
  return Number(match[1]) * unit
}

type HttpExtension = {
  status?: unknown
  statusCode?: unknown
  headers?: Record<string, unknown>
}

/**
 * Admin's rate limiter answers HTTP 200 with an `errors[]` entry whose only
 * marker is `extensions.http.statusCode: 429` (no `code`); an edge limiter
 * answers a bare HTTP 429. Both are the same transient outcome.
 */
function rateLimitedFrom(
  extensions: Record<string, unknown> | undefined,
): { retryAfterMs: number | null } | null {
  const http = extensions?.http as HttpExtension | undefined
  if (http == null || typeof http !== "object") return null
  if (http.statusCode !== 429 && http.status !== 429) return null
  const headers = http.headers ?? {}
  const retryAfter = headers["Retry-After"] ?? headers["retry-after"]
  return { retryAfterMs: parseRetryAfterMs(retryAfter) }
}

/** Map any thrown value from an Apollo call onto the client's failure shape. */
export function toRecommendationClientError(
  error: unknown,
): RecommendationClientError {
  if (error instanceof RecommendationClientError) return error
  if (CombinedGraphQLErrors.is(error)) {
    const first = error.errors[0]
    const code = first?.extensions?.code
    const recommendationCode = first?.extensions?.recommendationCode
    const limited = rateLimitedFrom(first?.extensions)
    if (limited) {
      return new RecommendationClientError("RATE_LIMITED", {
        retryAfterMs: limited.retryAfterMs,
        cause: error,
      })
    }
    const known: RecommendationFailureCode =
      code === "UNAUTHENTICATED" ||
      code === "BAD_USER_INPUT" ||
      code === "CONFLICT" ||
      code === "SERVICE_UNAVAILABLE"
        ? code
        : "GRAPHQL_ERROR"
    return new RecommendationClientError(known, {
      recommendationCode:
        typeof recommendationCode === "string" ? recommendationCode : null,
      cause: error,
    })
  }
  if (ServerError.is(error) && error.statusCode === 429) {
    return new RecommendationClientError("RATE_LIMITED", {
      retryAfterMs: parseRetryAfterMs(
        error.response?.headers?.get?.("retry-after") ?? null,
      ),
      cause: error,
    })
  }
  if (isClientAbortError(error)) {
    return new RecommendationClientError("TIMEOUT", { cause: error })
  }
  return new RecommendationClientError("NETWORK_ERROR", { cause: error })
}

/** The wait a rate-limited answer asks for, bounded to the limiter's window. */
export function rateLimitDelayMs(failure: RecommendationClientError): number {
  const asked = failure.retryAfterMs
  if (asked == null || asked <= 0) return RATE_LIMIT_WINDOW_MS
  return Math.min(asked, RATE_LIMIT_WINDOW_MS)
}

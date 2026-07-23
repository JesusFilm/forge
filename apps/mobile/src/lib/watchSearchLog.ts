import { CombinedGraphQLErrors } from "@apollo/client/errors"

// Pure, React-free helpers for the watch_search Log (search screen), so
// request-id generation, outcome selection, and error-code classification are
// unit-testable without the native Datadog SDK. The emit stays in watch.tsx.

// Monotonic per-process counter — a stable, unique id per search that a result
// click can join back to. No Date.now()/Math.random() at import time.
let searchRequestCounter = 0

/** Fresh correlation id for one search; monotonic within the JS process. */
export function generateSearchRequestId(): string {
  searchRequestCounter += 1
  return `search-${searchRequestCounter}`
}

// Admin returns these in a 200 body; Apollo v4 throws CombinedGraphQLErrors
// (v3's `.graphQLErrors` is gone). It sets no domain code on the search path —
// the rate limiter stamps http.statusCode — so fall back to that or telemetry
// reports "unknown" for exactly the throttling we most want to see.
export function parseSearchErrorCode(error: unknown): string {
  if (!CombinedGraphQLErrors.is(error)) return "unknown"
  const extensions = error.errors[0]?.extensions
  const code = extensions?.code
  if (typeof code === "string") return code
  const status = (extensions?.http as { statusCode?: unknown } | undefined)
    ?.statusCode
  return typeof status === "number" ? `http_${status}` : "unknown"
}

export type WatchSearchOutcome = {
  outcome: "results" | "empty" | "error"
  result_count: number
  code?: string
}

/**
 * Classifies one search: an error (with its GraphQL code), an empty result set,
 * or a non-empty one. `term` is part of the search context but does not affect
 * the outcome — it is logged separately at the emit site (R33).
 */
export function resolveWatchSearchOutcome({
  results,
  error,
}: {
  term: string
  results: readonly unknown[] | null | undefined
  error?: unknown
}): WatchSearchOutcome {
  if (error != null) {
    return {
      outcome: "error",
      result_count: 0,
      code: parseSearchErrorCode(error),
    }
  }
  const result_count = results?.length ?? 0
  return {
    outcome: result_count === 0 ? "empty" : "results",
    result_count,
  }
}

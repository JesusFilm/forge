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

// Admin surfaces rate-limit / auth / unavailable as a 200-body GraphQL error
// (never a 429, R34), so the code lives in the first error's extensions.
export function parseSearchErrorCode(error: unknown): string {
  const graphQLErrors = (
    error as {
      graphQLErrors?: readonly { extensions?: { code?: unknown } }[]
    } | null
  )?.graphQLErrors
  const code = graphQLErrors?.[0]?.extensions?.code
  return typeof code === "string" ? code : "unknown"
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

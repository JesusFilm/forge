import { CombinedGraphQLErrors } from "@apollo/client/errors"
import { uuidV4Fallback } from "./viewer-id"
import { SEARCH_LANGUAGE_SLUG } from "./watchSearch"

// Pure, React-free helpers for the watch_search Log (search screen), so
// request-id generation, outcome selection, and error-code classification are
// unit-testable without the native Datadog SDK. The emit stays in watch.tsx.

/** Fresh correlation id for one search — unique across installs, not per-process. */
export function generateSearchRequestId(): string {
  const runtimeCrypto = (
    globalThis as { crypto?: { randomUUID?: () => string } }
  ).crypto
  return runtimeCrypto?.randomUUID?.() ?? uuidV4Fallback()
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

// Web's outcome vocabulary (apps/web watch-search-analytics.ts); `failed`
// always carries a parsed code, pinned at the type level for the builder.
export type WatchSearchOutcome =
  | { outcome: "completed" | "no_result"; result_count: number }
  | { outcome: "failed"; result_count: number; code: string }

/**
 * Classifies one search: a failure (with its GraphQL code), an empty result
 * set, or a non-empty one. The failed branch wins even when results arrived.
 */
export function resolveWatchSearchOutcome({
  results,
  error,
}: {
  results: readonly unknown[] | null | undefined
  error?: unknown
}): WatchSearchOutcome {
  if (error != null) {
    return {
      outcome: "failed",
      result_count: 0,
      code: parseSearchErrorCode(error),
    }
  }
  const result_count = results?.length ?? 0
  return {
    outcome: result_count === 0 ? "no_result" : "completed",
    result_count,
  }
}

/** The one message web (watch-search-analytics.ts) and TV (search.ts) emit. */
export const WATCH_SEARCH_LOG_MESSAGE = "watch_search analytics"

export type WatchSearchRequestType = "search" | "load_more"

// Web's MAX_QUERY_LENGTH; the raw query is the sole raw-text field (R43).
const MAX_QUERY_LENGTH = 200

/** `priorVisibleCount` exists only on load_more, so a search can't carry it. */
export type WatchSearchLogAttributesInput = {
  outcome: WatchSearchOutcome
  searchRequestId: string
  query: string
  offset: number
  clientLatencyMs: number
  latencyMs?: number | null
  degraded?: boolean | null
  responseSearchMode?: string | null
} & (
  | { requestType: "search" }
  | { requestType: "load_more"; priorVisibleCount: number }
)

// Deliberate house-style break: mobile's `domain.event_name` + bare-keys log
// convention stays for mobile-only telemetry; search answers to an external
// `watch_search.*` contract shared with web and TV. Do not normalize it back.
export function buildWatchSearchLogAttributes(
  input: WatchSearchLogAttributesInput,
): Record<string, boolean | number | string> {
  const { outcome } = input
  const visibleResultCount =
    input.requestType === "load_more"
      ? nonNegativeInt(input.priorVisibleCount) + outcome.result_count
      : outcome.result_count

  // Anti-leak: every key assigned by name — the response and the error object
  // never reach this bag; the tests pin both exact key sets.
  const attributes: Record<string, boolean | number | string> = {
    "watch_search.event_name": "watch_search",
    "watch_search.exact_query_included": true,
    "watch_search.outcome": outcome.outcome,
    "watch_search.request_type": input.requestType,
    "watch_search.search_request_id": input.searchRequestId,
    "watch_search.query": input.query.slice(0, MAX_QUERY_LENGTH),
    "watch_search.result_count": outcome.result_count,
    "watch_search.visible_result_count": visibleResultCount,
    "watch_search.client_latency_ms": nonNegativeInt(input.clientLatencyMs),
    "watch_search.search_language_slug": SEARCH_LANGUAGE_SLUG,
    "watch_search.offset": nonNegativeInt(input.offset),
  }

  if (input.requestType === "load_more") {
    attributes["watch_search.added_result_count"] = outcome.result_count
  }

  if (outcome.outcome === "failed") {
    // Web's category vocabulary; a failed mobile request is always the search
    // call itself failing. Response scalars never ride a failure bag.
    attributes["watch_search.failure_category"] = "watch_search_error"
    attributes["watch_search.error_code"] = outcome.code
    return attributes
  }

  if (typeof input.latencyMs === "number" && input.latencyMs >= 0) {
    attributes["watch_search.latency_ms"] = input.latencyMs
  }
  if (typeof input.degraded === "boolean") {
    attributes["watch_search.degraded"] = input.degraded
  }
  if (input.responseSearchMode) {
    attributes["watch_search.response_search_mode"] = input.responseSearchMode
  }

  return attributes
}

function nonNegativeInt(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

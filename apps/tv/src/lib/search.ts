import { useCallback, useEffect, useRef, useState } from "react"

import { getApolloClient } from "./apolloClient"
import { datadogLog } from "./datadog"
import { WATCH_SEARCH, type SearchResult } from "./queries"
import { sanitizeQuery as sanitizeQueryImpl } from "./sanitizeQuery"
import { meetsMinQueryLength } from "./searchGate"
import {
  admitRunSearch,
  releasesSkipFlag,
  shouldRefireLiveQuery,
} from "./searchQueue"
import {
  buildWatchSearchInput,
  mapWatchSearchResponse,
  parseSearchErrorCode,
  SEARCH_LANGUAGE_SLUG,
} from "./watchSearch"
import {
  generateSearchRequestId,
  resolveWatchSearchOutcome,
} from "./watchSearchLog"

/** Debounce window from last query change to auto-submit. Raised from 600 ms so
 *  fewer in-progress prefixes each fire a server-side cold embedding. */
const DEFAULT_DEBOUNCE_MS = 900

/** Force the UI out of 'loading' if the active search request drops
 *  without resolving. */
const SEARCH_SAFETY_TIMEOUT_MS = 12_000

// Re-export so search.tsx imports from the familiar ../src/lib/search path.
// Impl lives in a React-free module so jest-expo loads the unit tests
// without pulling React's ESM type declarations through babel.
export const sanitizeQuery = sanitizeQueryImpl

// TV omits searchMode (no degraded-mode UX), so every search is the semantic /
// keyword-fallback path — the request_type reported on each watch_search log.
const WATCH_SEARCH_REQUEST_TYPE = "semantic"

// One shared emitter so the per-search Log mirrors web's canonical shape
// (message + watch_search.*-prefixed attributes), letting search_request_id
// join the result-click action on the same Datadog facet.
function emitWatchSearchLog(
  outcome: "completed" | "no_result" | "failed",
  resultCount: number,
  startedAt: number,
  searchRequestId: string,
  // Failure classification only — without it every failure looks like a timeout.
  errorCode?: string,
): void {
  datadogLog.info("watch_search analytics", {
    "watch_search.outcome": outcome,
    "watch_search.result_count": resultCount,
    "watch_search.latency_ms": Date.now() - startedAt,
    "watch_search.request_type": WATCH_SEARCH_REQUEST_TYPE,
    "watch_search.search_request_id": searchRequestId,
    ...(errorCode ? { "watch_search.error_code": errorCode } : {}),
  })
}

export type SearchState = "idle" | "loading" | "ready" | "empty" | "error"

type UseSemanticSearchResult = {
  state: SearchState
  results: SearchResult[]
  /**
   * Trimmed query the LATEST returned results are for; may lag the live
   * `query` when the user types past the last debounce-fired search. Lets
   * recent-history record the query that produced the visible results.
   */
  lastSubmittedQuery: string
  /**
   * Client-generated correlation id for the search behind the CURRENT visible
   * results. Threaded into the result-click RUM action so a click links back to
   * its per-search log. Empty until the first search resolves.
   */
  searchRequestId: string
  /** Force an immediate search for the current query, bypassing debounce. */
  submit: () => void
  /** Run an explicit query immediately, bypassing React state flush and
   *  debounce. Caller passes the exact query, dodging the stale-closure
   *  trap where setQuery()+submit() capture the prior `query` value. */
  runQuery: (q: string) => void
  /** Re-run the last non-empty query (error-state Retry button). */
  retry: () => void
}

type UseSemanticSearchOptions = {
  debounceMs?: number
  /** Admin language SLUG ("english"), NOT a BCP-47 tag — see SEARCH_LANGUAGE_SLUG. */
  displayLanguageSlug?: string
  limit?: number
}

/**
 * Debounced semantic search via getApolloClient().query, fetchPolicy 'no-cache'
 * (NOT useLazyQuery — fetchMore drops page 1, mobile-search-ui-patterns). Guards:
 * requestIdRef drops stale responses, isSubmittingRef blocks rapid-⏎ dups.
 */
export function useSemanticSearch(
  query: string,
  options: UseSemanticSearchOptions = {},
): UseSemanticSearchResult {
  const {
    debounceMs = DEFAULT_DEBOUNCE_MS,
    displayLanguageSlug = SEARCH_LANGUAGE_SLUG,
    limit = 40,
  } = options

  const [state, setState] = useState<SearchState>("idle")
  const [results, setResults] = useState<SearchResult[]>([])
  // Trimmed query the current visible results correspond to. Set by
  // runSearch on resolution so consumers record the query that produced
  // the results, not the live keyboard state that drifts ahead.
  const [lastSubmittedQuery, setLastSubmittedQuery] = useState<string>("")
  // Correlation id for the search behind the visible results; set on resolution
  // alongside lastSubmittedQuery so the result-click action reuses the same id
  // that its per-search log carried.
  const [searchRequestId, setSearchRequestId] = useState<string>("")

  const requestIdRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isSubmittingRef = useRef(false)
  const lastSubmittedQueryRef = useRef<string>("")
  const mountedRef = useRef(true)
  // One-shot: runQuery() sets this so the next debounce useEffect skips
  // its timer. Otherwise a chip-click setQuery→runQuery flow leaves a
  // queued debounce that fires a duplicate Apollo request 600ms later.
  const skipNextDebounceRef = useRef(false)
  // Live query mirror, read on settle to chase a query the in-flight guard
  // dropped. Reading live (not a captured value) is what stops an abandoned
  // term from resurrecting after the user has moved on.
  const queryRef = useRef(query)
  queryRef.current = query
  // Self-reference for that re-fire; runSearch can't call itself directly.
  const runSearchRef = useRef<((q: string) => void) | null>(null)

  // isSubmittingRef is the sole source of truth for in-flight state. A
  // prior React-state mirror lagged a render, letting two ⏎ in one tick
  // both fire runSearch. Render-time signal: derive from state==="loading".

  // Track mount state so in-flight promises don't set state after
  // the hook unmounts (e.g., user navigates away during search).
  useEffect(() => {
    return () => {
      mountedRef.current = false
      if (timerRef.current != null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      if (safetyTimerRef.current != null) {
        clearTimeout(safetyTimerRef.current)
        safetyTimerRef.current = null
      }
      // Invalidate any in-flight promises.
      requestIdRef.current += 1
    }
  }, [])

  const runSearch = useCallback(
    async (q: string) => {
      // Double-submit guard; the stale-response guard below covers the reverse.
      // Trimming happens here, not at the write site, so sanitizeQuery can keep
      // whitespace and "hello world" isn't eaten mid-stroke.
      const admission = admitRunSearch(q, isSubmittingRef.current)
      if (releasesSkipFlag(admission)) skipNextDebounceRef.current = false
      if (admission.kind === "in-flight") {
        if (__DEV__) console.log("[search] skipped — already submitting:", q)
        // The settle path re-reads the live query and chases it, so the drop is
        // recovered without capturing (and later resurrecting) this term.
        return
      }
      if (admission.kind === "empty") return
      const trimmed = admission.trimmed

      const thisRequest = requestIdRef.current + 1
      requestIdRef.current = thisRequest
      lastSubmittedQueryRef.current = trimmed
      // Synchronous ref write — a re-entrant call inside the same
      // tick (two ⏎ key dispatches) sees the in-flight state
      // immediately, no useEffect-mirror lag.
      isSubmittingRef.current = true
      setState("loading")

      // Per-search telemetry: one client id correlates the per-search log with a
      // later result-click; startedAt measures latency to the terminal branch.
      const requestSearchId = generateSearchRequestId()
      const startedAt = Date.now()

      if (__DEV__) {
        console.log("[search] firing query:", {
          q,
          thisRequest,
          displayLanguageSlug,
          limit,
        })
      }

      // Safety net: if the search request never settles within
      // SEARCH_SAFETY_TIMEOUT_MS, force the UI out of 'loading' so the user
      // gets feedback. Cleared in the finally block when the request resolves
      // normally.
      if (safetyTimerRef.current != null) {
        clearTimeout(safetyTimerRef.current)
      }
      safetyTimerRef.current = setTimeout(() => {
        safetyTimerRef.current = null
        if (requestIdRef.current !== thisRequest) return
        if (!mountedRef.current) return
        if (!isSubmittingRef.current) return
        if (__DEV__) {
          console.warn(
            "[search] safety timeout fired — request never resolved for:",
            q,
          )
        }
        setResults([])
        setState("error")
        isSubmittingRef.current = false
        emitWatchSearchLog("failed", 0, startedAt, requestSearchId, "timeout")
        // Bump requestIdRef so any late-arriving response from this
        // request is dropped (treat it as stale).
        requestIdRef.current += 1
      }, SEARCH_SAFETY_TIMEOUT_MS)

      try {
        const client = getApolloClient()
        const response = await client.query({
          query: WATCH_SEARCH,
          variables: {
            // Send the trimmed value: sanitizeQuery keeps whitespace at the
            // write site, so we strip once here rather than shipping
            // "  hello world  " to the embedding service.
            input: buildWatchSearchInput({
              query: trimmed,
              displayLanguageSlug,
              clientRequestId: requestSearchId,
              limit,
              offset: 0,
            }),
          },
          fetchPolicy: "no-cache",
        })

        // TV has no "load more" — one page of `limit` results is the whole set,
        // so hasMore/nextOffset are intentionally dropped here.
        const items: SearchResult[] = [
          ...mapWatchSearchResponse(response.data?.watchSearch, trimmed, 0)
            .results,
        ]

        if (__DEV__) {
          console.log("[search] response received:", {
            q,
            thisRequest,
            stale: requestIdRef.current !== thisRequest,
            mounted: mountedRef.current,
            count: items.length,
          })
        }

        // Stale-response guard: if a newer query started after we
        // fired this one, drop the result on the floor.
        if (requestIdRef.current !== thisRequest) return
        if (!mountedRef.current) return

        emitWatchSearchLog(
          resolveWatchSearchOutcome(items.length),
          items.length,
          startedAt,
          requestSearchId,
        )

        // Keyword-only (semantic-unavailable) responses flow through as
        // normal results — no separate degraded-mode UX.
        if (items.length === 0) {
          setResults([])
          setState("empty")
        } else {
          setResults(items)
          setState("ready")
        }
      } catch (err) {
        const code = parseSearchErrorCode(err)
        if (__DEV__) {
          // Apollo errors serialize operation.variables, which contains the user
          // query — keep this dev-only so prod logs never carry raw queries.
          console.error("[search] request error:", err)
          // watchSearch is public, so a bad token never surfaces here — it just
          // costs the per-device rate-limit bucket. rate_limited is the one
          // code worth calling out, since retrying immediately makes it worse.
          if (code === "rate_limited") {
            console.warn("[search] rate limited by admin — back off and retry")
          }
        }
        if (requestIdRef.current !== thisRequest) return
        if (!mountedRef.current) return
        emitWatchSearchLog("failed", 0, startedAt, requestSearchId, code)
        setResults([])
        setState("error")
      } finally {
        // Staleness-guard timer-clear and in-flight release: a superseded
        // response must NOT clear the active request's safety timer (now in
        // safetyTimerRef) nor release the in-flight guard.
        if (requestIdRef.current === thisRequest && mountedRef.current) {
          if (safetyTimerRef.current != null) {
            clearTimeout(safetyTimerRef.current)
            safetyTimerRef.current = null
          }
          isSubmittingRef.current = false
          // Surface the trimmed query that drove these results so recent-
          // history records the right value, not the live keyboard state
          // that may have advanced past `trimmed` during the round-trip.
          setLastSubmittedQuery(trimmed)
          // Pair the id with the visible results so a click reuses it.
          setSearchRequestId(requestSearchId)

          // Chase a query the in-flight guard dropped. A still-scheduled
          // debounce owns its own retry, so only recover the already-fired case.
          if (
            shouldRefireLiveQuery(
              queryRef.current,
              trimmed,
              timerRef.current != null,
            )
          ) {
            runSearchRef.current?.(queryRef.current)
          }
        }
      }
    },
    [displayLanguageSlug, limit],
  )

  useEffect(() => {
    runSearchRef.current = (q: string) => void runSearch(q)
  }, [runSearch])

  // Debounced auto-submit on query change. Empty queries reset state
  // to idle and clear any pending timer.
  useEffect(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (query.trim().length === 0) {
      // Whitespace-only input is treated as empty: stay idle, no call.
      // sanitizeQuery keeps whitespace at the write site, so gate on
      // trim().length without losing the user's typed-but-unfollowed space.
      requestIdRef.current += 1
      // Bumping requestIdRef invalidates the in-flight request, whose
      // finally then skips the isSubmittingRef reset. Release the guards
      // here too, else the next search is dropped at the in-flight early-return.
      isSubmittingRef.current = false
      if (safetyTimerRef.current != null) {
        clearTimeout(safetyTimerRef.current)
        safetyTimerRef.current = null
      }
      setState("idle")
      setResults([])
      // Clear lastSubmittedQuery too so a fresh search records as
      // a new entry rather than dedup-skipping against the prior
      // submission.
      setLastSubmittedQuery("")
      setSearchRequestId("")
      return
    }

    if (skipNextDebounceRef.current) {
      // runQuery() already fired runSearch for this query value;
      // clear the flag and skip scheduling a duplicate.
      skipNextDebounceRef.current = false
      return
    }

    // Below the minimum length, don't fire: a 1-2 char prefix would pay a cold
    // embedding for almost no signal. The immediate paths above (submit /
    // runQuery / retry) bypass this and still fire for short known terms.
    if (!meetsMinQueryLength(query)) return

    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void runSearch(query)
    }, debounceMs)

    return () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [query, debounceMs, runSearch])

  const submit = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    void runSearch(query)
  }, [query, runSearch])

  // Run an explicit query immediately. Callers that just setQuery (chip /
  // category card) can't use submit() — it closes over the prior `query`
  // until React commits. Threading the value dodges that staleness window.
  const runQuery = useCallback(
    (q: string) => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      // Tell the next debounce useEffect to skip: callers do setQuery(q)
      // before runQuery(q), and we don't want that query-change to
      // schedule a duplicate 600ms-later runSearch for the same value.
      skipNextDebounceRef.current = true
      void runSearch(q)
    },
    [runSearch],
  )

  const retry = useCallback(() => {
    const last = lastSubmittedQueryRef.current
    if (last.length === 0) return
    void runSearch(last)
  }, [runSearch])

  return {
    state,
    results,
    lastSubmittedQuery,
    searchRequestId,
    submit,
    runQuery,
    retry,
  }
}

import { useCallback, useEffect, useRef, useState } from "react"

import { getApolloClient } from "./apolloClient"
import { SEMANTIC_SEARCH, type SearchResult } from "./queries"
import { sanitizeQuery as sanitizeQueryImpl } from "./sanitizeQuery"
import { meetsMinQueryLength } from "./searchGate"

/** Debounce window from last query change to auto-submit. Raised from 600 ms so
 *  fewer in-progress prefixes each fire a server-side cold embedding. */
const DEFAULT_DEBOUNCE_MS = 900

/** Force the UI out of 'loading' if the Apollo link/cache pipeline drops
 *  the response without resolving. Set below Apollo's 15 s fetch timeout
 *  so the user sees a client-side error, not two stacked timeouts. */
const SEARCH_SAFETY_TIMEOUT_MS = 12_000

// Re-export so search.tsx imports from the familiar ../src/lib/search path.
// Impl lives in a React-free module so jest-expo loads the unit tests
// without pulling React's ESM type declarations through babel.
export const sanitizeQuery = sanitizeQueryImpl

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
  locale?: string
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
    locale = "en",
    limit = 40,
  } = options

  const [state, setState] = useState<SearchState>("idle")
  const [results, setResults] = useState<SearchResult[]>([])
  // Trimmed query the current visible results correspond to. Set by
  // runSearch on resolution so consumers record the query that produced
  // the results, not the live keyboard state that drifts ahead.
  const [lastSubmittedQuery, setLastSubmittedQuery] = useState<string>("")

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
      // Double-submit guard: if another search is already in-flight,
      // ignore this call. The stale-response guard below handles the
      // reverse case (older response after a newer query fires).
      if (isSubmittingRef.current) {
        if (__DEV__) console.log("[search] skipped — already submitting:", q)
        return
      }
      // Trim at the firing site, not the write site: sanitizeQuery keeps
      // whitespace so typing "hello world" isn't eaten mid-stroke. Only
      // suppress the call when the trimmed query is empty.
      const trimmed = q.trim()
      if (trimmed.length === 0) return

      const thisRequest = requestIdRef.current + 1
      requestIdRef.current = thisRequest
      lastSubmittedQueryRef.current = trimmed
      // Synchronous ref write — a re-entrant call inside the same
      // tick (two ⏎ key dispatches) sees the in-flight state
      // immediately, no useEffect-mirror lag.
      isSubmittingRef.current = true
      setState("loading")

      if (__DEV__) {
        console.log("[search] firing query:", { q, thisRequest, locale, limit })
      }

      // Safety net: if Apollo never settles within SEARCH_SAFETY_TIMEOUT_MS,
      // force the UI out of 'loading' so the user gets feedback. Cleared in
      // the finally block when the request resolves normally.
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
            "[search] safety timeout fired — Apollo never resolved for:",
            q,
          )
        }
        setResults([])
        setState("error")
        isSubmittingRef.current = false
        // Bump requestIdRef so any late-arriving response from this
        // request is dropped (treat it as stale).
        requestIdRef.current += 1
      }, SEARCH_SAFETY_TIMEOUT_MS)

      try {
        const client = getApolloClient()
        const response = await client.query({
          query: SEMANTIC_SEARCH,
          // Send the trimmed value: sanitizeQuery keeps whitespace at the
          // write site, so we strip once here rather than shipping
          // "  hello world  " to the embedding service.
          variables: { query: trimmed, locale, limit },
          fetchPolicy: "no-cache",
        })

        // Apollo + gql.tada infer this from SEMANTIC_SEARCH, no cast
        // needed. Letting the schema flow through trips tsc here on a
        // future field-type tightening instead of passing silently.
        const payload = response.data?.semanticSearch
        const items = payload?.results ?? []

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
        if (__DEV__) {
          // Apollo errors serialize operation.variables, which
          // contains the user query — keep this dev-only so prod
          // logs never carry raw query strings.
          console.error("[search] Apollo error:", err)
        }
        if (requestIdRef.current !== thisRequest) return
        if (!mountedRef.current) return
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
        }
      }
    },
    [locale, limit],
  )

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

  return { state, results, lastSubmittedQuery, submit, runQuery, retry }
}

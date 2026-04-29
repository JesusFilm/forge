import { useCallback, useEffect, useRef, useState } from "react"

import { getApolloClient } from "./apolloClient"
import { SEMANTIC_SEARCH, type SearchResult } from "./queries"
import { sanitizeQuery as sanitizeQueryImpl } from "./sanitizeQuery"

/** Debounce window from last query change to auto-submit. Longer than
 *  web's 300 ms because TV input is slower and we want fewer round trips. */
const DEFAULT_DEBOUNCE_MS = 600

/** Hard cap on how long the UI stays in 'loading' state before falling
 *  to 'error'. The Apollo HttpLink has a 15 s fetch timeout, but if
 *  anything in the link / cache pipeline drops the response without
 *  resolving the promise, the UI would hang forever otherwise. 12 s
 *  triggers slightly before the Apollo timeout so the user sees the
 *  client-side error message rather than waiting for two timeouts. */
const SEARCH_SAFETY_TIMEOUT_MS = 12_000

// Re-export the sanitizer so apps/tv/app/search.tsx can import from the
// familiar ../src/lib/search path. The implementation lives in a
// React-free module so the jest-expo preset can load the unit tests
// without pulling React's ESM type declarations through babel.
export const sanitizeQuery = sanitizeQueryImpl

export type SearchState =
  | "idle"
  | "loading"
  | "ready"
  | "empty"
  | "error"
  | "degraded"

type UseSemanticSearchResult = {
  state: SearchState
  results: SearchResult[]
  /**
   * The trimmed query string the LATEST returned results are for —
   * may differ from the consumer's live `query` state when the user
   * has typed past the most-recent debounce-fired search. Used by
   * the recent-history caller to record the query that actually
   * produced the visible results, not the in-progress new query.
   */
  lastSubmittedQuery: string
  /** Force an immediate search for the current query, bypassing the
   *  debounce timer. */
  submit: () => void
  /** Run an explicit query immediately, bypassing both React state
   *  flush and the debounce. The caller passes the exact query to fire,
   *  avoiding the stale-closure trap where setQuery() + submit() would
   *  capture the prior `query` value because submit's useCallback hasn't
   *  re-baked with the new state yet. */
  runQuery: (q: string) => void
  /** Re-run the last non-empty query. Used by the Retry button in
   *  error / degraded states. */
  retry: () => void
}

type UseSemanticSearchOptions = {
  debounceMs?: number
  locale?: string
  limit?: number
}

/**
 * Debounced semantic search hook. Uses getApolloClient().query with
 * fetchPolicy: 'no-cache' (NOT useLazyQuery — fetchMore silently drops
 * page 1 per mobile-search-ui-patterns learning). Guards:
 *
 *  - requestIdRef: discard stale responses when a newer query fires
 *    mid-flight.
 *  - isSubmittingRef: ignore submit() calls while a prior search is
 *    still in-flight (prevents rapid-⏎ duplicate calls — adversarial
 *    finding from doc review).
 *  - Empty query is a no-op: state returns to 'idle' and no network
 *    call fires.
 *
 * The 'degraded' state is entered when the CMS response's searchMode
 * is 'keyword-only' — signaling the OpenRouter embedding service is
 * unavailable and we should render a distinct "temporarily unavailable"
 * message instead of collapsing silently into "no results".
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
  // Public lastSubmittedQuery state: the trimmed query the *current
  // visible results* correspond to. Driven from runSearch on
  // resolution; surfaced so consumers (e.g., recent-history record
  // effect) can record the query that produced the visible results
  // rather than the user's live keyboard state, which can drift
  // ahead during the debounce window.
  const [lastSubmittedQuery, setLastSubmittedQuery] = useState<string>("")

  const requestIdRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isSubmittingRef = useRef(false)
  const lastSubmittedQueryRef = useRef<string>("")
  const mountedRef = useRef(true)
  // One-shot flag: set true by runQuery() to tell the next debounce
  // useEffect run to skip scheduling its 600ms timer. Without this,
  // a chip click → setQuery → runQuery flow leaves a queued debounce
  // that fires a duplicate Apollo request 600ms later (caught only
  // by the in-flight guard if the original is still pending; on fast
  // networks the duplicate fires for real).
  const skipNextDebounceRef = useRef(false)

  // isSubmittingRef is the sole source of truth for in-flight state.
  // An earlier version mirrored a React isSubmitting state via a
  // useEffect — the mirror lagged by one render, letting two ⏎
  // presses in the same tick both observe `false` and both fire
  // runSearch. The React state has been removed; consumers that
  // need a render-time signal should derive from `state === "loading"`.

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
      // Trim at the firing site (not the write site). sanitizeQuery
      // preserves leading/internal/trailing whitespace so the user can
      // type "hello world" without the space being eaten mid-typing;
      // we only suppress the network call when the trimmed query is
      // empty (whitespace-only input or empty string).
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

      // Safety net: if Apollo's promise neither resolves nor rejects
      // within SEARCH_SAFETY_TIMEOUT_MS, force the UI out of 'loading'
      // so the user gets feedback instead of staring at the spinner.
      // Cleared in the finally block below when the request resolves
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
          // Send the trimmed value to the backend — sanitizeQuery
          // intentionally preserves whitespace at the write site, so
          // we strip it once here at the firing site rather than
          // shipping "hello " or "  hello world  " to the embedding
          // service.
          variables: { query: trimmed, locale, limit },
          fetchPolicy: "no-cache",
        })

        // Apollo + gql.tada infer this as the SearchResponse derived
        // from SEMANTIC_SEARCH; no manual cast needed. Letting the
        // schema flow through means a future tightening
        // (e.g. searchMode -> string-literal union) trips tsc here
        // instead of silently passing.
        const payload = response.data?.semanticSearch
        const items = payload?.results ?? []
        const mode = payload?.searchMode

        if (__DEV__) {
          console.log("[search] response received:", {
            q,
            thisRequest,
            stale: requestIdRef.current !== thisRequest,
            mounted: mountedRef.current,
            mode,
            count: items.length,
          })
        }

        // Stale-response guard: if a newer query started after we
        // fired this one, drop the result on the floor.
        if (requestIdRef.current !== thisRequest) return
        if (!mountedRef.current) return

        if (mode === "keyword-only") {
          // Backend fell back to keyword-only retrieval (OpenRouter
          // embedding unavailable). Render the distinct "temporarily
          // unavailable" UX per R24.
          setResults(items)
          setState("degraded")
        } else if (items.length === 0) {
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
        // Both timer-clear and in-flight release are guarded by the
        // same staleness check: a late-arriving response from a
        // superseded request must NOT clear the *active* request's
        // safety timer (which was overwritten into safetyTimerRef when
        // the newer request started), and must NOT release the
        // in-flight guard.
        if (requestIdRef.current === thisRequest && mountedRef.current) {
          if (safetyTimerRef.current != null) {
            clearTimeout(safetyTimerRef.current)
            safetyTimerRef.current = null
          }
          isSubmittingRef.current = false
          // Surface the trimmed query that drove these results so
          // recent-history records the correct value (not the live
          // keyboard state, which may have advanced past `trimmed`
          // during the network round-trip).
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
      // Whitespace-only input is treated the same as empty: stay in
      // idle, don't fire a network call. sanitizeQuery preserves
      // whitespace at the write site, so the in-memory `query` may
      // be a non-empty whitespace string after the keyboard's space
      // key fires; checking `trim().length` here gates that case
      // without losing the user's typed-but-not-yet-followed-up space.
      requestIdRef.current += 1
      // Bumping requestIdRef invalidates any in-flight request — its
      // finally block is gated on requestIdRef.current === thisRequest
      // and will skip the isSubmittingRef reset. Without releasing
      // the in-flight guards here, a subsequent search would be
      // permanently dropped at the line-143 early-return. Reset
      // synchronously so the hook is usable again immediately.
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

  // Run an explicit query immediately. Callers that just set state to a
  // new query value (recent chip / category card) cannot use submit()
  // because submit() closes over the prior `query` until React commits
  // the next render. Threading the value directly avoids that one-render
  // staleness window.
  const runQuery = useCallback(
    (q: string) => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      // Tell the next debounce useEffect run to skip — the caller
      // typically does setQuery(q) before runQuery(q) and we don't
      // want the resulting query-change to schedule a duplicate
      // 600ms-later runSearch for the same value.
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

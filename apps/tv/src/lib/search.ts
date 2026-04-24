import { useCallback, useEffect, useRef, useState } from "react"

import { getApolloClient } from "./apolloClient"
import {
  SEMANTIC_SEARCH,
  type SearchResponse,
  type SearchResult,
} from "./queries"
import { sanitizeQuery as sanitizeQueryImpl } from "./sanitizeQuery"

/** Debounce window from last query change to auto-submit. Longer than
 *  web's 300 ms because TV input is slower and we want fewer round trips. */
const DEFAULT_DEBOUNCE_MS = 600

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
  /** Force an immediate search, bypassing the debounce timer. */
  submit: () => void
  /** Re-run the last non-empty query. Used by the Retry button in
   *  error / degraded states. */
  retry: () => void
  /** True while an Apollo query is in-flight. Used by the submit key
   *  to render a loading indicator and by the double-⏎ guard below. */
  isSubmitting: boolean
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
  const [isSubmitting, setIsSubmitting] = useState(false)

  const requestIdRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isSubmittingRef = useRef(false)
  const lastSubmittedQueryRef = useRef<string>("")
  const mountedRef = useRef(true)

  // Mirror isSubmitting state into a ref so submit() can read it
  // synchronously without race conditions between setState and next
  // event loop tick.
  useEffect(() => {
    isSubmittingRef.current = isSubmitting
  }, [isSubmitting])

  // Track mount state so in-flight promises don't set state after
  // the hook unmounts (e.g., user navigates away during search).
  useEffect(() => {
    return () => {
      mountedRef.current = false
      if (timerRef.current != null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
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
      if (isSubmittingRef.current) return
      if (q.length === 0) return

      const thisRequest = requestIdRef.current + 1
      requestIdRef.current = thisRequest
      lastSubmittedQueryRef.current = q
      setIsSubmitting(true)
      setState("loading")

      try {
        const client = getApolloClient()
        const response = await client.query({
          query: SEMANTIC_SEARCH,
          variables: { query: q, locale, limit },
          fetchPolicy: "no-cache",
        })

        // Stale-response guard: if a newer query started after we
        // fired this one, drop the result on the floor.
        if (requestIdRef.current !== thisRequest) return
        if (!mountedRef.current) return

        const payload = response.data?.semanticSearch as
          | SearchResponse
          | undefined
        const items = (payload?.results ?? []) as SearchResult[]
        const mode = payload?.searchMode

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
      } catch {
        if (requestIdRef.current !== thisRequest) return
        if (!mountedRef.current) return
        setResults([])
        setState("error")
      } finally {
        // Guard finally with the same stale-check so a late-arriving
        // failure from a superseded query does not clear a new query's
        // loading state. The loadMore pattern in mobile uses an
        // unguarded finally for a different reason; search submit
        // needs the guard.
        if (requestIdRef.current === thisRequest && mountedRef.current) {
          setIsSubmitting(false)
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

    if (query.length === 0) {
      // Invalidate any in-flight response so it does not overwrite
      // the idle state when it eventually resolves.
      requestIdRef.current += 1
      setState("idle")
      setResults([])
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

  const retry = useCallback(() => {
    const last = lastSubmittedQueryRef.current
    if (last.length === 0) return
    void runSearch(last)
  }, [runSearch])

  return { state, results, submit, retry, isSubmitting }
}

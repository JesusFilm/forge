// Lazily loads the full public language list for the Settings pickers: pages
// GET_LANGUAGES (server cap 500/page), normalizes to WatchChildLanguage, and
// caches for the session — the corpus is stable reference data (~2.2k rows).

import { useCallback, useEffect, useRef, useState } from "react"

import { getApolloClient } from "../lib/apolloClient"
import { collectAllLanguages, LANGUAGES_PAGE_SIZE } from "../lib/allLanguages"
import { GET_LANGUAGES } from "../lib/languageQueries"
import {
  normalizeChildDubLanguages,
  type WatchChildLanguage,
} from "../lib/normalizeVideo"

// Apollo honors no per-call deadline (outbound-timeout law): race each page
// against a rejection so a hung admin surfaces as the panel's retry row.
const LANGUAGES_PAGE_TIMEOUT_MS = 8000

let cachedLanguages: WatchChildLanguage[] | null = null

type UseAllLanguagesResult = {
  /** Normalized, deduped list; null until loaded (or on error). */
  languages: WatchChildLanguage[] | null
  loading: boolean
  error: boolean
  /** Re-runs a failed fetch; no-op while one is in flight or after success. */
  retry: () => void
}

export function useAllLanguages(enabled: boolean): UseAllLanguagesResult {
  const [languages, setLanguages] = useState<WatchChildLanguage[] | null>(
    cachedLanguages,
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const inFlightRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    // Setup restores what cleanup mutates (StrictMode remounts reuse the instance).
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const fetchLanguages = useCallback(() => {
    if (inFlightRef.current) return
    if (cachedLanguages != null) {
      // Another instance's fetch may have filled the cache after this one
      // seeded its state — sync instead of wedging at null with a no-op retry.
      setLanguages(cachedLanguages)
      return
    }
    inFlightRef.current = true
    setLoading(true)
    setError(false)
    void (async () => {
      try {
        const raw = await collectAllLanguages(async (offset) => {
          // Abort the transport on timeout too: otherwise Apollo's dedup would
          // pin an immediate retry to the still-hung request instead of
          // issuing a fresh one.
          const abort = new AbortController()
          // Lazy client getter — never module-scope (apps/tv/CLAUDE.md).
          const queryPromise = getApolloClient().query({
            query: GET_LANGUAGES,
            variables: { limit: LANGUAGES_PAGE_SIZE, offset },
            // Pages cache by their variables, so a retry after a mid-run
            // failure re-reads the completed pages instead of refetching.
            fetchPolicy: "cache-first",
            context: { fetchOptions: { signal: abort.signal } },
          })
          let timeoutId: ReturnType<typeof setTimeout> | undefined
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
              abort.abort()
              reject(new Error("languages_fetch_timeout"))
            }, LANGUAGES_PAGE_TIMEOUT_MS)
          })
          try {
            const res = await Promise.race([queryPromise, timeoutPromise])
            return res.data?.languages ?? []
          } finally {
            if (timeoutId !== undefined) clearTimeout(timeoutId)
          }
        })
        cachedLanguages = normalizeChildDubLanguages(raw)
        if (!mountedRef.current) return
        setLanguages(cachedLanguages)
      } catch {
        if (!mountedRef.current) return
        setError(true)
      } finally {
        inFlightRef.current = false
        if (mountedRef.current) setLoading(false)
      }
    })()
  }, [])

  useEffect(() => {
    if (enabled) fetchLanguages()
  }, [enabled, fetchLanguages])

  return { languages, loading, error, retry: fetchLanguages }
}

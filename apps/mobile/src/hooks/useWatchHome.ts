import { useCallback, useEffect, useRef, useState } from "react"

import { getApolloClient } from "../lib/apolloClient"
import { GET_WATCH_HOME_VIDEOS } from "../lib/queries"
import { getWatchHomeCoreIds } from "../lib/watchHome/config"
import {
  buildWatchHomeModelFromVideos,
  type WatchHomeModel,
} from "../lib/watchHome/model"

// KTD-7: the app-wide hardcoded locale pair. The model keys locale/variant
// selection on languageSlug, never bcp47 (en-nai/en collide on prefix).
const HOME_LOCALE = "en"
const HOME_LANGUAGE_SLUG = "english"

// Errors surface as a retryable message (never a throw) so the screen renders
// error-with-retry instead of a blank surface (R12).
const RETRYABLE_ERROR_MESSAGE = "Couldn't load videos. Please try again."

export type WatchHomeState = {
  model: WatchHomeModel | null
  /** Initial load — no model yet. Pull-to-refresh uses `refreshing` instead. */
  loading: boolean
  refreshing: boolean
  error: string | null
  /** Network-only refetch suited to pull-to-refresh. */
  refetch: () => void
}

/**
 * One lean bulk fetch (GET_WATCH_HOME_VIDEOS over getWatchHomeCoreIds())
 * built into the home model. Imperative getApolloClient().query — lazy
 * getter, never module scope — with the watch.tsx stale-response guard: an
 * incrementing requestId ref invalidates any in-flight fetch a newer one
 * supersedes.
 */
export function useWatchHome(): WatchHomeState {
  const [model, setModel] = useState<WatchHomeModel | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const fetchHome = useCallback(async (mode: "initial" | "refresh") => {
    const thisRequest = ++requestIdRef.current
    if (mode === "initial") setLoading(true)
    else setRefreshing(true)
    setError(null)

    try {
      const result = await getApolloClient().query({
        query: GET_WATCH_HOME_VIDEOS,
        variables: {
          coreIds: getWatchHomeCoreIds(),
          locale: HOME_LOCALE,
          languageSlug: HOME_LANGUAGE_SLUG,
        },
        // Initial load reuses the cache; explicit refetch forces the network.
        fetchPolicy: mode === "initial" ? "cache-first" : "network-only",
      })
      if (requestIdRef.current !== thisRequest) return
      setModel(
        buildWatchHomeModelFromVideos({
          videos: result.data?.watchHomeVideos ?? [],
          languageSlug: HOME_LANGUAGE_SLUG,
        }),
      )
    } catch {
      if (requestIdRef.current !== thisRequest) return
      // Keep any previously-built model so a failed refresh degrades to stale
      // content + a retry affordance, not a blank screen.
      setError(RETRYABLE_ERROR_MESSAGE)
    } finally {
      if (requestIdRef.current === thisRequest) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    void fetchHome("initial")
  }, [fetchHome])

  const refetch = useCallback(() => {
    void fetchHome("refresh")
  }, [fetchHome])

  return { model, loading, refreshing, error, refetch }
}

// SYNC: ported from apps/mobile/src/hooks/useWatchHome.ts. The lean bulk
// fetch + pure model build are identical; TV's model drops the carousel/pager
// machinery (see ../lib/watchHome/model.ts).

import { useCallback, useEffect, useRef, useState } from "react"

import { getApolloClient } from "../lib/apolloClient"
import {
  ENGLISH_LANGUAGE_SLUG,
  HOME_LOCALE,
  getWatchHomeCoreIds,
} from "../lib/watchHome/config"
import { GET_WATCH_HOME_VIDEOS } from "../lib/watchHome/homeQueries"
import {
  buildWatchHomeModelFromVideos,
  type WatchHomeModel,
} from "../lib/watchHome/model"

// Errors surface as a retryable message (never a throw) so the screen renders
// error-with-retry instead of a blank surface (R16).
const RETRYABLE_ERROR_MESSAGE = "Couldn't load videos. Please try again."

export type WatchHomeState = {
  model: WatchHomeModel | null
  /**
   * True while a fetch is in flight. Spinner shows only when `model` is null
   * (initial load / retry); once a model exists, content renders through
   * background refreshes.
   */
  loading: boolean
  error: string | null
  /** Network-only refetch suited to a retry action. */
  refetch: () => void
}

/**
 * One lean bulk fetch (GET_WATCH_HOME_VIDEOS over getWatchHomeCoreIds()) built
 * into the home model. Imperative getApolloClient().query (lazy getter, never
 * module scope); an incrementing requestId ref discards stale responses.
 */
export function useWatchHome(): WatchHomeState {
  const [model, setModel] = useState<WatchHomeModel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const fetchHome = useCallback(async (mode: "initial" | "refresh") => {
    const thisRequest = ++requestIdRef.current
    // Unconditional — a retry from the error state clears `error` below, so
    // without `loading` the model==null screen would fall through to the
    // empty state ("No content available") for the whole round trip.
    setLoading(true)
    setError(null)

    try {
      const result = await getApolloClient().query({
        query: GET_WATCH_HOME_VIDEOS,
        variables: {
          coreIds: getWatchHomeCoreIds(),
          locale: HOME_LOCALE,
          languageSlug: ENGLISH_LANGUAGE_SLUG,
        },
        // Initial load reuses the cache; explicit refetch forces the network.
        fetchPolicy: mode === "initial" ? "cache-first" : "network-only",
      })
      if (requestIdRef.current !== thisRequest) return
      setModel(
        buildWatchHomeModelFromVideos({
          videos: result.data?.watchHomeVideos ?? [],
          languageSlug: ENGLISH_LANGUAGE_SLUG,
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
      }
    }
  }, [])

  useEffect(() => {
    void fetchHome("initial")
  }, [fetchHome])

  const refetch = useCallback(() => {
    void fetchHome("refresh")
  }, [fetchHome])

  return { model, loading, error, refetch }
}

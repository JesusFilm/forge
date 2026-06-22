import { useCallback, useEffect, useRef, useState } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"

import { getApolloClient } from "../lib/apolloClient"
import { GET_WATCH_HOME_VIDEOS } from "../lib/queries"
import {
  ENGLISH_LANGUAGE_SLUG,
  HOME_LOCALE,
  getWatchHomeCoreIds,
} from "../lib/watchHome/config"
import {
  buildWatchHomeModelFromVideos,
  type WatchHomeModel,
} from "../lib/watchHome/model"
import {
  WATCH_HOME_SNAPSHOT_MAX_BYTES,
  WATCH_HOME_SNAPSHOT_STORAGE_KEY,
  parseStoredHomeSnapshot,
  serializeHomeSnapshotFromVideosJson,
} from "../lib/watchHomePersistence"

// Errors surface as a retryable message (never a throw) so the screen renders
// error-with-retry instead of a blank surface (R12).
const RETRYABLE_ERROR_MESSAGE = "Couldn't load videos. Please try again."

export type WatchHomeState = {
  model: WatchHomeModel | null
  /** No model painted yet (neither network nor snapshot) — the spinner gate. */
  loading: boolean
  refreshing: boolean
  error: string | null
  /** Network-only refetch suited to pull-to-refresh. */
  refetch: () => void
}

/** Fire-and-forget; an empty response never overwrites a good snapshot. */
function persistHomeSnapshot(videosJson: string): void {
  const blob = serializeHomeSnapshotFromVideosJson(videosJson, new Date())
  if (blob.length > WATCH_HOME_SNAPSHOT_MAX_BYTES) return
  AsyncStorage.setItem(WATCH_HOME_SNAPSHOT_STORAGE_KEY, blob).catch(() => {
    // Write failures lose the fast next launch, nothing else.
  })
}

/**
 * Lean bulk home fetch with a requestId-ref stale-response guard (newer fetch
 * invalidates older). Stale-while-revalidate: paint the prior launch's snapshot
 * immediately (admin TTFB 2.5-6s dominates launch), revalidate in background.
 * Unchanged response keeps the snapshot model — swapping identity rebuilds the
 * hero queue and resets the pager mid-viewing. Pull-to-refresh always swaps.
 */
export function useWatchHome(): WatchHomeState {
  const [model, setModel] = useState<WatchHomeModel | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  // Once live data lands, a late-arriving snapshot must not paint over it.
  const networkLandedRef = useRef(false)
  // JSON of the painted snapshot's videos array (set only when a
  // snapshot-built model was painted); the live fetch string-compares against
  // it to decide keep-or-swap without re-stringifying the snapshot side.
  const snapshotVideosJsonRef = useRef<string | null>(null)

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
          languageSlug: ENGLISH_LANGUAGE_SLUG,
        },
        // Initial load reuses the cache; explicit refetch forces the network.
        fetchPolicy: mode === "initial" ? "cache-first" : "network-only",
      })
      if (requestIdRef.current !== thisRequest) return
      networkLandedRef.current = true
      const videos = result.data?.watchHomeVideos ?? []
      // Empty-but-successful initial response over a painted snapshot degrades
      // like a failed fetch — never paint full-empty over good content. Same
      // rule persistHomeSnapshot applies at the storage layer.
      if (
        mode === "initial" &&
        videos.length === 0 &&
        snapshotVideosJsonRef.current != null
      ) {
        setError(RETRYABLE_ERROR_MESSAGE)
        return
      }
      // One stringify of the ~460KB payload, reused for both the equality
      // compare and the persisted blob.
      const videosJson = JSON.stringify(videos)
      const snapshotStillCurrent =
        mode === "initial" && videosJson === snapshotVideosJsonRef.current
      if (!snapshotStillCurrent) {
        setModel(
          buildWatchHomeModelFromVideos({
            videos,
            languageSlug: ENGLISH_LANGUAGE_SLUG,
          }),
        )
      }
      if (videos.length > 0) persistHomeSnapshot(videosJson)
    } catch {
      if (requestIdRef.current !== thisRequest) return
      // Keep any previously-built model (snapshot included) so a failed fetch
      // degrades to stale content + a retry affordance, not a blank screen.
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

  // Snapshot paint, concurrent with the initial fetch. The disk read + model
  // build finish in tens of milliseconds; the network needs seconds — so this
  // wins the race on a cold launch and the spinner is skipped entirely.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(WATCH_HOME_SNAPSHOT_STORAGE_KEY)
        if (cancelled || networkLandedRef.current) return
        const snapshot = parseStoredHomeSnapshot(raw, new Date())
        if (snapshot == null) return
        const snapshotModel = buildWatchHomeModelFromVideos({
          videos: snapshot.videos,
          languageSlug: ENGLISH_LANGUAGE_SLUG,
        })
        if (cancelled || networkLandedRef.current) return
        snapshotVideosJsonRef.current = JSON.stringify(snapshot.videos)
        setModel(snapshotModel)
        // A painted model ends the spinner phase; the still-running initial
        // fetch is a background revalidation, not a loading state.
        setLoading(false)
      } catch {
        // A snapshot the model builder rejects is corrupt — drop it so the
        // next launch goes back to a clean network-first start.
        AsyncStorage.removeItem(WATCH_HOME_SNAPSHOT_STORAGE_KEY).catch(() => {})
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const refetch = useCallback(() => {
    void fetchHome("refresh")
  }, [fetchHome])

  return { model, loading, refreshing, error, refetch }
}

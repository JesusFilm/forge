// SYNC: ported from apps/mobile/src/hooks/useWatchHome.ts. The lean bulk fetch +
// pure model build are identical; TV's model drops the carousel/pager machinery
// (see ../lib/watchHome/model.ts). Adds the stale-while-revalidate snapshot (U3):
// paint the prior launch's home model instantly while the live fetch revalidates.

import { useCallback, useEffect, useRef, useState } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"

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
import {
  WATCH_HOME_SNAPSHOT_MAX_BYTES,
  WATCH_HOME_SNAPSHOT_STORAGE_KEY,
  parseStoredHomeSnapshot,
  serializeHomeSnapshotFromVideosJson,
} from "../lib/watchHome/homeSnapshot"

// Errors surface as a retryable message (never a throw) so the screen renders
// error-with-retry instead of a blank surface (R16).
const RETRYABLE_ERROR_MESSAGE = "Couldn't load videos. Please try again."

export type WatchHomeState = {
  model: WatchHomeModel | null
  /**
   * True while a fetch is in flight. The skeleton shows only when `model` is null
   * (initial load before snapshot/network); once a model exists, content renders
   * through background refreshes.
   */
  loading: boolean
  error: string | null
  /** Network-only refetch suited to a retry action. */
  refetch: () => void
}

/** Fire-and-forget; an empty response never reaches here, and an oversized blob
 *  is dropped so the next launch goes back to a clean network-first start. */
function persistHomeSnapshot(videosJson: string): void {
  const blob = serializeHomeSnapshotFromVideosJson(videosJson, new Date())
  if (blob.length > WATCH_HOME_SNAPSHOT_MAX_BYTES) return
  AsyncStorage.setItem(WATCH_HOME_SNAPSHOT_STORAGE_KEY, blob).catch(() => {
    // Write failures lose the fast next launch, nothing else.
  })
}

/**
 * One lean bulk fetch (GET_WATCH_HOME_VIDEOS over getWatchHomeCoreIds()) built
 * into the home model, with a requestId-ref stale-response guard. Stale-while-
 * revalidate: paint the prior launch's snapshot immediately, revalidate in the
 * background, and swap only when the live response actually differs.
 */
export function useWatchHome(): WatchHomeState {
  const [model, setModel] = useState<WatchHomeModel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  // Once live data lands, a late-arriving snapshot read must not paint over it.
  const networkLandedRef = useRef(false)
  // JSON of the painted snapshot's videos (set only when a snapshot model was
  // painted); the live fetch string-compares to decide keep-or-swap.
  const snapshotVideosJsonRef = useRef<string | null>(null)

  const fetchHome = useCallback(async (mode: "initial" | "refresh") => {
    const thisRequest = ++requestIdRef.current
    // Unconditional — a retry from the error state clears `error` below, so
    // without `loading` the model==null screen would fall through to the empty
    // state for the whole round trip. With a painted model it shows content.
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
      networkLandedRef.current = true
      const videos = result.data?.watchHomeVideos ?? []
      // Empty-but-successful initial response over a painted snapshot degrades
      // like a failed fetch — never paint full-empty over good content.
      if (
        mode === "initial" &&
        videos.length === 0 &&
        snapshotVideosJsonRef.current != null
      ) {
        setError(RETRYABLE_ERROR_MESSAGE)
        return
      }
      // One stringify of the ~450KB payload, reused for the compare + the blob.
      const videosJson = JSON.stringify(videos)
      // Unchanged response keeps the painted snapshot model — no swap, so a
      // focused rail card isn't disturbed mid-navigation (KTD3 focus note: the
      // swap fires only when live actually differs from the snapshot).
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
      }
    }
  }, [])

  useEffect(() => {
    void fetchHome("initial")
  }, [fetchHome])

  // Snapshot paint, concurrent with the initial fetch. The disk read + model
  // build finish in tens of milliseconds; the network needs seconds — so this
  // wins the race on a cold launch and the skeleton is replaced by real content.
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
        // A painted model ends the skeleton phase; the still-running initial
        // fetch is a background revalidation, not a loading state.
        setLoading(false)
      } catch {
        // A snapshot the model builder rejects is corrupt — drop it so the next
        // launch goes back to a clean network-first start.
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

  return { model, loading, error, refetch }
}

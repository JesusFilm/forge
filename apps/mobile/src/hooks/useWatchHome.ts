import { useCallback, useEffect, useRef, useState } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"

import { getApolloClient } from "../lib/apolloClient"
import { GET_WATCH_HOME_VIDEOS, GET_WATCH_SETTING } from "../lib/queries"
import {
  ENGLISH_LANGUAGE_SLUG,
  HOME_LOCALE,
  getWatchHomeCoreIds,
} from "../lib/watchHome/config"
import {
  buildWatchHomeModelFromVideos,
  type WatchHomeModel,
  type WatchHomeSection,
} from "../lib/watchHome/model"
import {
  buildWatchHomeSectionsFromExperience,
  resolveWatchHomeModel,
} from "../lib/watchHome/experienceAdapter"
import {
  logWatchHomeFallback,
  type WatchHomeFallbackReason,
} from "../lib/watchHome/logWatchHomeFallback"
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
 * Lean bulk home fetch with a requestId-ref stale-response guard. Stale-while-
 * revalidate: paint the prior launch's snapshot immediately (admin TTFB 2.5-6s),
 * revalidate in background. Unchanged response keeps the model (pager intact).
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
      const client = getApolloClient()
      // Initial load reuses the cache; explicit refetch forces the network.
      const fetchPolicy = mode === "initial" ? "cache-first" : "network-only"
      // Body source (homepage Experience) + hero/fallback source (config
      // videos) fetch in parallel. The videos fetch feeds the hero carousel and
      // the config fallback and is required; the Experience fetch is additive —
      // its failure or absence degrades to the config body, never a hard error.
      const [videosOutcome, experienceOutcome] = await Promise.allSettled([
        client.query({
          query: GET_WATCH_HOME_VIDEOS,
          variables: {
            coreIds: getWatchHomeCoreIds(),
            locale: HOME_LOCALE,
            languageSlug: ENGLISH_LANGUAGE_SLUG,
          },
          fetchPolicy,
        }),
        client.query({
          query: GET_WATCH_SETTING,
          variables: { locale: HOME_LOCALE },
          fetchPolicy,
        }),
      ])
      if (requestIdRef.current !== thisRequest) return

      // The required videos source failed — keep any painted model (snapshot
      // included) and surface a retry affordance, not a blank screen.
      if (videosOutcome.status === "rejected") {
        setError(RETRYABLE_ERROR_MESSAGE)
        return
      }
      networkLandedRef.current = true
      const videos = videosOutcome.value.data?.watchHomeVideos ?? []
      // Empty-but-successful videos over a painted snapshot degrades like a
      // failed fetch — never paint full-empty over good content.
      if (
        mode === "initial" &&
        videos.length === 0 &&
        snapshotVideosJsonRef.current != null
      ) {
        setError(RETRYABLE_ERROR_MESSAGE)
        return
      }
      // One stringify of the ~460KB payload, reused for the equality compare and
      // the persisted blob.
      const videosJson = JSON.stringify(videos)
      const configModel = buildWatchHomeModelFromVideos({
        videos,
        languageSlug: ENGLISH_LANGUAGE_SLUG,
      })

      // Derive the Experience body and a fallback reason when it isn't usable.
      let experienceSections: WatchHomeSection[] = []
      let fallbackReason: WatchHomeFallbackReason = "null"
      if (experienceOutcome.status === "rejected") {
        fallbackReason = "error"
      } else {
        const homepage =
          experienceOutcome.value.data?.watchSetting?.homepageExperience
        if (homepage == null) {
          fallbackReason = "null"
        } else {
          experienceSections = buildWatchHomeSectionsFromExperience(
            homepage.blocks as readonly {
              readonly __typename?: string | null
            }[],
          )
          if (experienceSections.length === 0) fallbackReason = "empty"
        }
      }

      const { model: nextModel, usedExperience } = resolveWatchHomeModel({
        configModel,
        experienceSections,
      })
      // Keep the painted snapshot model when the config body is unchanged AND we
      // aren't swapping in an Experience body — avoids resetting the hero pager.
      const snapshotStillCurrent =
        mode === "initial" &&
        !usedExperience &&
        videosJson === snapshotVideosJsonRef.current
      if (!snapshotStillCurrent) setModel(nextModel)
      if (!usedExperience) logWatchHomeFallback({ reason: fallbackReason })
      if (videos.length > 0) persistHomeSnapshot(videosJson)
    } catch {
      if (requestIdRef.current !== thisRequest) return
      // Keep any previously-built model (snapshot included) so a failure
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

import { useCallback, useEffect, useRef, useState } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"

import { getApolloClient } from "../lib/apolloClient"
import { datadogLog } from "../lib/datadog"
import { clearAllHeroStreamCooldowns } from "../lib/watchHome/heroStreamCooldown"
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
import { withTimeout } from "../lib/withTimeout"
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

// A slow/hung homepage-Experience query must not hold the required videos load
// (and the first-launch spinner) hostage — cap the wait well under the HTTP
// timeout, then degrade to the last-good or config body (#2, R9).
const EXPERIENCE_FETCH_DEADLINE_MS = 8000

type ExperienceBlockList = readonly { readonly __typename?: string | null }[]

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
function persistHomeSnapshot(videosJson: string, blocksJson: string): void {
  const blob = serializeHomeSnapshotFromVideosJson(
    videosJson,
    new Date(),
    blocksJson,
  )
  if (blob.length > WATCH_HOME_SNAPSHOT_MAX_BYTES) return
  AsyncStorage.setItem(WATCH_HOME_SNAPSHOT_STORAGE_KEY, blob).catch(() => {
    // Write failures lose the fast next launch, nothing else.
    datadogLog.warn("home_snapshot.write_failed", {})
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
  // JSON of the painted snapshot's Experience blocks ("null" for the config
  // body), paired with snapshotVideosJsonRef for the keep-model compare.
  const snapshotBlocksJsonRef = useRef<string | null>(null)
  // Last Experience blocks that yielded >=1 shelf; reused when a transient
  // Experience fetch error would otherwise downgrade a good body to config (#1).
  const lastGoodExperienceBlocksRef = useRef<ExperienceBlockList | null>(null)
  // Home-ready fires once per source so the network paint's real admin TTFB
  // stays distinct from the ~50ms snapshot paint (R21).
  const homeReadySnapshotEmittedRef = useRef(false)
  const homeReadyNetworkEmittedRef = useRef(false)

  const fetchHome = useCallback(async (mode: "initial" | "refresh") => {
    const thisRequest = ++requestIdRef.current
    if (mode === "initial") setLoading(true)
    else setRefreshing(true)
    setError(null)

    try {
      const client = getApolloClient()
      // Initial load reuses the cache; explicit refetch forces the network.
      const fetchPolicy = mode === "initial" ? "cache-first" : "network-only"
      // Body source (Experience) + hero/fallback source (config videos) fetch in
      // parallel. Videos is required (feeds hero + config fallback); the Experience
      // is additive — its failure or absence degrades to the config body, never a throw.
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
        withTimeout(
          client.query({
            query: GET_WATCH_SETTING,
            variables: { locale: HOME_LOCALE },
            fetchPolicy,
          }),
          EXPERIENCE_FETCH_DEADLINE_MS,
        ),
      ])
      if (requestIdRef.current !== thisRequest) return

      // The required videos source failed — keep any painted model (snapshot
      // included) and surface a retry affordance, not a blank screen.
      if (videosOutcome.status === "rejected") {
        // R14/R22: record the failed required-videos load so slow/retried loads
        // stay in the home-ready distribution, not only fast successes.
        datadogLog.warn("watch_home.videos_failed", {})
        datadogLog.info("home_feed_ready", {
          source: "network",
          outcome: "failed",
        })
        setError(RETRYABLE_ERROR_MESSAGE)
        return
      }
      networkLandedRef.current = true
      // A successful network-only refresh proves connectivity — release hero
      // stream cooldowns so recovered slides return without waiting out windows.
      if (mode === "refresh") clearAllHeroStreamCooldowns()
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

      // Derive the Experience body. A transient Experience error (incl. the
      // deadline above) reuses the last-good blocks so a network blip can't
      // downgrade an already-good body to the config fallback (#1).
      let experienceBlocks: ExperienceBlockList | null = null
      let fallbackReason: WatchHomeFallbackReason = "null"
      if (experienceOutcome.status === "rejected") {
        // R14: the ~8s Experience deadline tripped (or the query rejected) —
        // the client gave up and the body degrades to last-good/config.
        datadogLog.warn("watch_home.experience_deadline", {})
        fallbackReason = "error"
        experienceBlocks = lastGoodExperienceBlocksRef.current
      } else {
        const homepage =
          experienceOutcome.value.data?.watchSetting?.homepageExperience
        if (homepage != null) {
          experienceBlocks = homepage.blocks as ExperienceBlockList
        }
      }
      const experienceSections: WatchHomeSection[] = experienceBlocks
        ? buildWatchHomeSectionsFromExperience(experienceBlocks)
        : []
      // A resolved Experience mapping to zero shelves is "empty", not an error —
      // the config fallback still logs a distinct reason (a reused-on-error body
      // keeps "error").
      if (
        experienceOutcome.status === "fulfilled" &&
        experienceBlocks != null &&
        experienceSections.length === 0
      ) {
        fallbackReason = "empty"
      }
      // Remember blocks that produced a real body for the next transient error.
      if (experienceSections.length >= 1 && experienceBlocks != null) {
        lastGoodExperienceBlocksRef.current = experienceBlocks
      }

      const { model: nextModel, usedExperience } = resolveWatchHomeModel({
        configModel,
        experienceSections,
      })
      // The painted body's source, tagged: Experience blocks when it won, else
      // "null" (config body). Persisted so cold launch repaints the same source.
      const blocksJson =
        usedExperience && experienceBlocks != null
          ? JSON.stringify(experienceBlocks)
          : "null"
      // Keep the painted snapshot model when both the config videos and the body
      // source are unchanged — avoids resetting the hero pager on a no-op
      // revalidation.
      const snapshotStillCurrent =
        mode === "initial" &&
        videosJson === snapshotVideosJsonRef.current &&
        blocksJson === snapshotBlocksJsonRef.current
      if (!snapshotStillCurrent) setModel(nextModel)
      if (!homeReadyNetworkEmittedRef.current) {
        // R21: the network paint carries the real admin TTFB, kept distinct
        // from the snapshot paint so an instant snapshot can't mask a slow fetch.
        homeReadyNetworkEmittedRef.current = true
        datadogLog.info("home_feed_ready", { source: "network" })
      }
      if (!usedExperience) {
        logWatchHomeFallback({ reason: fallbackReason })
      } else if (experienceOutcome.status === "rejected") {
        // Reused last-good over a live Experience error — still logged so a
        // prolonged endpoint outage isn't silent behind a cached body (R11).
        logWatchHomeFallback({ reason: "error-recovered" })
      }
      if (videos.length > 0) persistHomeSnapshot(videosJson, blocksJson)
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
        // Rebuild the exact painted source: the config carousel + fallback body
        // from videos, and the Experience body from the tagged blocks when present.
        const snapshotConfig = buildWatchHomeModelFromVideos({
          videos: snapshot.videos,
          languageSlug: ENGLISH_LANGUAGE_SLUG,
        })
        const snapshotSections = snapshot.blocks
          ? buildWatchHomeSectionsFromExperience(snapshot.blocks)
          : []
        const { model: snapshotModel } = resolveWatchHomeModel({
          configModel: snapshotConfig,
          experienceSections: snapshotSections,
        })
        if (cancelled || networkLandedRef.current) return
        snapshotVideosJsonRef.current = JSON.stringify(snapshot.videos)
        snapshotBlocksJsonRef.current = snapshot.blocks
          ? JSON.stringify(snapshot.blocks)
          : "null"
        // Seed last-good from the snapshot so a transient network Experience
        // error right after a cold-launch paint keeps the snapshot body (#1).
        if (snapshotSections.length >= 1 && snapshot.blocks) {
          lastGoodExperienceBlocksRef.current = snapshot.blocks
        }
        setModel(snapshotModel)
        if (!homeReadySnapshotEmittedRef.current) {
          homeReadySnapshotEmittedRef.current = true
          datadogLog.info("home_feed_ready", { source: "snapshot" })
        }
        // A painted model ends the spinner phase; the still-running initial
        // fetch is a background revalidation, not a loading state.
        setLoading(false)
      } catch {
        // A snapshot the model builder rejects is corrupt — drop it so the
        // next launch goes back to a clean network-first start.
        datadogLog.warn("home_snapshot.corrupt", {})
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

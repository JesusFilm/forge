// SYNC: ported from apps/mobile/src/hooks/useWatchHome.ts; TV DIVERGES by hydrating
// each Experience item by coreId through the bulk fetch (mobile renders flat), with
// a config fallback and an SWR v2 snapshot for instant cold-launch paint.

import { useCallback, useEffect, useRef, useState } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"

import { getApolloClient } from "../lib/apolloClient"
import {
  ENGLISH_LANGUAGE_SLUG,
  HOME_LOCALE,
  getWatchHomeCoreIds,
} from "../lib/watchHome/config"
import {
  GET_WATCH_HOME_VIDEOS,
  GET_WATCH_SETTING,
} from "../lib/watchHome/homeQueries"
import {
  buildWatchHomeSectionsFromExperience,
  experienceItemCoreIds,
  reconcileWatchHome,
  resolveWatchHomeModel,
  type ExperienceBlock,
  type ExperienceOutcomeKind,
  type PrimaryVideosState,
} from "../lib/watchHome/experienceAdapter"
import { logWatchHomeFallback } from "../lib/watchHome/logWatchHomeFallback"
import {
  buildVideoByCoreIdIndex,
  buildWatchHomeModelFromVideos,
  type WatchHomeModel,
  type WatchHomeSection,
  type WatchHomeVideoInput,
} from "../lib/watchHome/model"
import {
  WATCH_HOME_SNAPSHOT_MAX_BYTES,
  WATCH_HOME_SNAPSHOT_STORAGE_KEY,
  parseStoredHomeSnapshot,
  serializeHomeSnapshotFromVideosJson,
} from "../lib/watchHome/homeSnapshot"
import { fetchTopUpVideos, type FetchPolicy } from "../lib/watchHome/topUpFetch"
import { withTimeout } from "../lib/withTimeout"

// Errors surface as a retryable message (never a throw) so the screen renders
// error-with-retry instead of a blank surface (R10/R15).
const RETRYABLE_ERROR_MESSAGE = "Couldn't load videos. Please try again."

// The Experience and top-up fetches get a client deadline so a slow admin degrades
// to the fallback fast; the load-bearing primary videos fetch relies on the Apollo
// link request timeout (its slowness routes to retry, not a silent stall).
const EXPERIENCE_FETCH_DEADLINE_MS = 8000
const TOPUP_FETCH_DEADLINE_MS = 8000

type ExperienceBlockList = readonly ExperienceBlock[]

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
function persistHomeSnapshot(videosJson: string, blocksJson: string): void {
  const blob = serializeHomeSnapshotFromVideosJson(
    videosJson,
    new Date(),
    blocksJson,
  )
  if (blob.length > WATCH_HOME_SNAPSHOT_MAX_BYTES) return
  AsyncStorage.setItem(WATCH_HOME_SNAPSHOT_STORAGE_KEY, blob).catch(() => {
    // Write failures lose the fast next launch, nothing else.
  })
}

/**
 * Two parallel fetches (config-pool videos + watch-home Experience) built into the
 * home model, with a requestId-ref stale-response guard. Stale-while-revalidate:
 * paint the prior launch's snapshot immediately, revalidate in the background, and
 * swap only when the live response actually differs.
 */
export function useWatchHome(): WatchHomeState {
  const [model, setModel] = useState<WatchHomeModel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  // Once live data lands, a late-arriving snapshot read must not paint over it.
  const networkLandedRef = useRef(false)
  // JSON of the painted snapshot's videos/blocks (set only when a snapshot model was
  // painted); the live fetch string-compares to decide keep-or-swap.
  const snapshotVideosJsonRef = useRef<string | null>(null)
  const snapshotBlocksJsonRef = useRef<string | null>(null)
  // Last Experience blocks that yielded >=1 rail — reused on a transient
  // watchSetting error so a blip doesn't downgrade to the code rows (R9).
  const lastGoodExperienceBlocksRef = useRef<ExperienceBlockList | null>(null)

  const fetchHome = useCallback(async (mode: "initial" | "refresh") => {
    const thisRequest = ++requestIdRef.current
    // Unconditional — a retry from the error state clears `error` below, so
    // without `loading` the model==null screen would fall through to the empty
    // state for the whole round trip. With a painted model it shows content.
    setLoading(true)
    setError(null)

    const client = getApolloClient()
    // Initial load reuses the cache; explicit refetch forces the network.
    const fetchPolicy: FetchPolicy =
      mode === "initial" ? "cache-first" : "network-only"

    try {
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

      // The load-bearing config-pool fetch. A rejected primary — or an empty-but-
      // successful response over a painted snapshot (never paint full-empty over
      // good content) — can hydrate nothing; reconcileWatchHome routes both to the
      // retry state below, keeping that decision in one place (R10/AE10).
      let primary: PrimaryVideosState
      let videos: readonly WatchHomeVideoInput[] = []
      if (videosOutcome.status === "rejected") {
        primary = { kind: "rejected" }
      } else {
        videos = videosOutcome.value.data?.watchHomeVideos ?? []
        networkLandedRef.current = true
        if (
          mode === "initial" &&
          videos.length === 0 &&
          snapshotVideosJsonRef.current != null
        ) {
          primary = { kind: "empty-over-snapshot" }
        } else {
          primary = {
            kind: "ok",
            configModel: buildWatchHomeModelFromVideos({
              videos,
              languageSlug: ENGLISH_LANGUAGE_SLUG,
            }),
          }
        }
      }

      // Experience hydration runs only on the ok path; a non-ok primary reconciles
      // straight to the retry-error state.
      let experienceBlocks: ExperienceBlockList | null = null
      let experienceOutcomeKind: ExperienceOutcomeKind = "absent"
      let experienceSections: WatchHomeSection[] = []
      let mergedVideos: readonly WatchHomeVideoInput[] = videos
      let topUpFailed = false
      if (primary.kind === "ok") {
        // A rejected watchSetting reuses the last-good body (R9); a fulfilled-but-
        // null homepage is "absent"; otherwise the live blocks.
        const liveBlocks: ExperienceBlockList | null =
          experienceOutcome.status === "fulfilled"
            ? ((experienceOutcome.value.data?.watchSetting?.homepageExperience
                ?.blocks as ExperienceBlockList | undefined) ?? null)
            : null
        experienceOutcomeKind =
          experienceOutcome.status === "rejected"
            ? "error"
            : liveBlocks != null
              ? "present"
              : "absent"
        experienceBlocks =
          experienceOutcome.status === "rejected"
            ? lastGoodExperienceBlocksRef.current
            : liveBlocks

        // Top-up ONLY the item coreIds uncovered by the built index keyset (child
        // episodes are already indexed — KTD3/KTD4). A rejected/slow top-up degrades:
        // drop the divergent items, keep config-pool rows, log topup-error (R10/AE14).
        let videoByCoreId = buildVideoByCoreIdIndex(videos)
        if (experienceBlocks != null) {
          const divergent = experienceItemCoreIds(experienceBlocks).filter(
            (coreId) => !videoByCoreId.has(coreId),
          )
          if (divergent.length > 0) {
            try {
              const topUp = await withTimeout(
                fetchTopUpVideos(client, divergent, fetchPolicy),
                TOPUP_FETCH_DEADLINE_MS,
              )
              // The single post-allSettled guard does not cover this new await.
              if (requestIdRef.current !== thisRequest) return
              mergedVideos = [...videos, ...topUp]
              videoByCoreId = buildVideoByCoreIdIndex(mergedVideos)
            } catch {
              if (requestIdRef.current !== thisRequest) return
              topUpFailed = true
            }
          }
        }
        experienceSections = experienceBlocks
          ? buildWatchHomeSectionsFromExperience(
              experienceBlocks,
              videoByCoreId,
            )
          : []
      }

      // reconcileWatchHome is the single R8/R9/R10 decision point: it maps the
      // primary state + experience result to the body and the reasons to log.
      const reconciled = reconcileWatchHome({
        primary,
        experienceSections,
        experienceOutcome: experienceOutcomeKind,
        experienceBlocks,
        topUpFailed,
      })
      if (reconciled.kind === "error") {
        setError(RETRYABLE_ERROR_MESSAGE)
        return
      }
      if (reconciled.nextLastGoodBlocks !== undefined) {
        lastGoodExperienceBlocksRef.current = reconciled.nextLastGoodBlocks
      }

      // Keep the painted snapshot when the live result is identical, so a focused
      // rail card isn't disturbed mid-navigation.
      const videosJson = JSON.stringify(mergedVideos)
      const blocksJson =
        reconciled.usedExperience && experienceBlocks != null
          ? JSON.stringify(experienceBlocks)
          : "null"
      const snapshotStillCurrent =
        mode === "initial" &&
        videosJson === snapshotVideosJsonRef.current &&
        blocksJson === snapshotBlocksJsonRef.current
      if (!snapshotStillCurrent) setModel(reconciled.model)

      // Never-silent (R12): every revert/degrade emits its structured reason.
      for (const reason of reconciled.logs) logWatchHomeFallback({ reason })

      if (mergedVideos.length > 0) persistHomeSnapshot(videosJson, blocksJson)
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
        // Rebuild the index from the MERGED snapshot videos so divergent cards
        // rehydrate on cold launch; render the Experience body if one was persisted.
        const configModel = buildWatchHomeModelFromVideos({
          videos: snapshot.videos,
          languageSlug: ENGLISH_LANGUAGE_SLUG,
        })
        const videoByCoreId = buildVideoByCoreIdIndex(snapshot.videos)
        const experienceSections = snapshot.blocks
          ? buildWatchHomeSectionsFromExperience(snapshot.blocks, videoByCoreId)
          : []
        const { model: snapshotModel } = resolveWatchHomeModel({
          configModel,
          experienceSections,
        })
        if (cancelled || networkLandedRef.current) return
        snapshotVideosJsonRef.current = JSON.stringify(snapshot.videos)
        snapshotBlocksJsonRef.current = snapshot.blocks
          ? JSON.stringify(snapshot.blocks)
          : "null"
        // Seed last-good so a transient Experience error just after cold launch
        // keeps the snapshot body rather than downgrading to the code rows (R9).
        if (experienceSections.length >= 1 && snapshot.blocks) {
          lastGoodExperienceBlocksRef.current = snapshot.blocks
        }
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

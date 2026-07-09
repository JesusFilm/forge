// SYNC: ported from apps/mobile/src/hooks/useWatchHome.ts. TV drops the
// carousel/pager machinery (see ../lib/watchHome/model.ts) and DIVERGES by
// hydrating each Experience item by coreId through the bulk fetch (mobile renders
// flat). Fetches the config-pool videos + the watch-home Experience in parallel,
// tops up any genuinely-uncovered item coreIds, and falls back to the code-curated
// rows on Experience absence / error / zero rails. SWR snapshot (v2) paints the
// prior launch's Experience body instantly while the live fetch revalidates.

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
} from "../lib/watchHome/experienceAdapter"
import { logWatchHomeFallback } from "../lib/watchHome/logWatchHomeFallback"
import {
  buildVideoByCoreIdIndex,
  buildWatchHomeModelFromVideos,
  type WatchHomeModel,
  type WatchHomeVideoInput,
} from "../lib/watchHome/model"
import {
  WATCH_HOME_SNAPSHOT_MAX_BYTES,
  WATCH_HOME_SNAPSHOT_STORAGE_KEY,
  parseStoredHomeSnapshot,
  serializeHomeSnapshotFromVideosJson,
} from "../lib/watchHome/homeSnapshot"
import { withTimeout } from "../lib/withTimeout"

// Errors surface as a retryable message (never a throw) so the screen renders
// error-with-retry instead of a blank surface (R10/R15).
const RETRYABLE_ERROR_MESSAGE = "Couldn't load videos. Please try again."

// Only the Experience fetch is bounded — a slow admin must not stall the whole
// Home render; the config-pool videos fetch feeds the fallback rows and is not wrapped.
const EXPERIENCE_FETCH_DEADLINE_MS = 8000

// admin's watchHomeVideos caps at 100 coreIds and throws over it — chunk the top-up.
const VIDEOS_BY_CORE_IDS_MAX = 100

type FetchPolicy = "cache-first" | "network-only"
type ExperienceBlockList = readonly ExperienceBlock[]
type ApolloClient = ReturnType<typeof getApolloClient>

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

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

/** Top-up hydration for editor-added coreIds the config pool doesn't cover.
 *  Chunked under the 100-id cap; any rejected chunk rejects the whole top-up so
 *  the caller degrades (drop divergent items, keep the config-pool rows). */
async function fetchTopUpVideos(
  client: ApolloClient,
  coreIds: readonly string[],
  fetchPolicy: FetchPolicy,
): Promise<WatchHomeVideoInput[]> {
  const batches = await Promise.all(
    chunk(coreIds, VIDEOS_BY_CORE_IDS_MAX).map((ids) =>
      client.query({
        query: GET_WATCH_HOME_VIDEOS,
        variables: {
          coreIds: ids,
          locale: HOME_LOCALE,
          languageSlug: ENGLISH_LANGUAGE_SLUG,
        },
        fetchPolicy,
      }),
    ),
  )
  return batches.flatMap((result) => result.data?.watchHomeVideos ?? [])
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

      // The config-pool videos fetch is load-bearing: it feeds the hero AND the
      // fallback rows, neither of which can hydrate without it (R10/AE10).
      if (videosOutcome.status === "rejected") {
        setError(RETRYABLE_ERROR_MESSAGE)
        return
      }
      networkLandedRef.current = true
      const videos = videosOutcome.value.data?.watchHomeVideos ?? []

      // Empty-but-successful over a painted snapshot degrades like a failed fetch —
      // never paint full-empty over good content.
      if (
        mode === "initial" &&
        videos.length === 0 &&
        snapshotVideosJsonRef.current != null
      ) {
        setError(RETRYABLE_ERROR_MESSAGE)
        return
      }

      // Derive the Experience body. A rejected watchSetting reuses the last-good
      // body (R9); a fulfilled-but-null homepage is "absent"; otherwise live blocks.
      const liveBlocks: ExperienceBlockList | null =
        experienceOutcome.status === "fulfilled"
          ? ((experienceOutcome.value.data?.watchSetting?.homepageExperience
              ?.blocks as ExperienceBlockList | undefined) ?? null)
          : null
      const experienceOutcomeKind: ExperienceOutcomeKind =
        experienceOutcome.status === "rejected"
          ? "error"
          : liveBlocks != null
            ? "present"
            : "absent"
      const experienceBlocks: ExperienceBlockList | null =
        experienceOutcome.status === "rejected"
          ? lastGoodExperienceBlocksRef.current
          : liveBlocks

      // Hydration index from the config pool; top-up ONLY the coreIds genuinely
      // uncovered by the built index keyset (child episodes are already indexed —
      // KTD3/KTD4). A rejected top-up degrades: drop the divergent items, keep the
      // config-pool rows, and log topup-error (R10/AE14) — never blank the home.
      let mergedVideos: readonly WatchHomeVideoInput[] = videos
      let videoByCoreId = buildVideoByCoreIdIndex(videos)
      let topUpFailed = false
      if (experienceBlocks != null) {
        const divergent = experienceItemCoreIds(experienceBlocks).filter(
          (coreId) => !videoByCoreId.has(coreId),
        )
        if (divergent.length > 0) {
          try {
            const topUp = await fetchTopUpVideos(client, divergent, fetchPolicy)
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

      const configModel = buildWatchHomeModelFromVideos({
        videos,
        languageSlug: ENGLISH_LANGUAGE_SLUG,
      })
      const experienceSections = experienceBlocks
        ? buildWatchHomeSectionsFromExperience(experienceBlocks, videoByCoreId)
        : []

      // The R8/R9/R10 decision is a pure function (see reconcileWatchHome): it
      // picks the body and the fallback reasons to emit. `primary` is always ok
      // here — the rejected / empty-over-snapshot cases returned above.
      const reconciled = reconcileWatchHome({
        primary: { kind: "ok", configModel },
        experienceSections,
        experienceOutcome: experienceOutcomeKind,
        experienceBlocks,
        topUpFailed,
      })
      if (reconciled.kind !== "model") return
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

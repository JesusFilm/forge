import { useCallback, useEffect, useRef, useState } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"

import {
  adminFormsFor,
  currentAdminForms,
  type AdminLanguageForms,
} from "../i18n/adminLanguage"
import { getCatalogTag, getLocaleEpoch } from "../i18n/localeStore"
import { useLocaleEpoch } from "../i18n/useT"
import { getApolloClient } from "../lib/apolloClient"
import { datadogLog } from "../lib/datadog"
import { clearAllHeroStreamCooldowns } from "../lib/watchHome/heroStreamCooldown"
import { GET_WATCH_HOME_VIDEOS, GET_WATCH_SETTING } from "../lib/queries"
import { getWatchHomeCoreIds } from "../lib/watchHome/config"
import {
  buildVideoByCoreIdIndex,
  type WatchHomeModel,
  type WatchHomeVideoInput,
} from "../lib/watchHome/model"
import {
  assembleWatchHomeModel,
  experienceItemCoreIds,
  type HomepageSource,
} from "../lib/watchHome/experienceAdapter"
import {
  fetchTopUpVideos,
  lastGoodHydrationFor,
  resolveHydrationVideos,
  type LastGoodHydration,
  type TopUpOutcome,
} from "../lib/watchHome/topUpFetch"
import { localeQueryVariables, videoTextVariables } from "../lib/videoText"
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
  type WatchHomeSnapshotText,
} from "../lib/watchHomePersistence"

// Errors surface as a retryable message (never a throw) so the screen renders
// error-with-retry instead of a blank surface (R12).
const RETRYABLE_ERROR_MESSAGE = "Couldn't load videos. Please try again."

// A slow/hung homepage-Experience query must not hold the required videos load
// (and the first-launch spinner) hostage — cap the wait well under the HTTP
// timeout, then degrade to the last-good or config body (#2, R9).
const EXPERIENCE_FETCH_DEADLINE_MS = 8000

// The divergent-coreId hydration fetch gets its own client deadline — kept WELL
// below the Experience deadline because, on a snapshot-less first launch, the
// single paint (hero included) waits on this; degrading a few cards to mux + slug
// is cheap, so bound the wait tightly rather than block the hero for long.
const TOPUP_FETCH_DEADLINE_MS = 3000

type ExperienceBlockList = readonly { readonly __typename?: string | null }[]

// KTD16: the last Experience blocks that yielded a body, with their locale and
// homepage source. They are reused only under that locale.
type LastGoodExperience = {
  locale: string
  homepageSource: HomepageSource
  blocks: ExperienceBlockList
}

/**
 * The painted body, held in ONE state slot so a render can never pair a new
 * model with the previous model's authored position (KTD1).
 */
type WatchHomeBody = {
  model: WatchHomeModel | null
  recommendationsInsertIndex: number | null
  /** The locale epoch the body was built in (KTD16). A body from an older
   *  epoch never renders, not even for the frame before the clear lands. */
  epoch: number
}

const EMPTY_BODY: WatchHomeBody = {
  model: null,
  recommendationsInsertIndex: null,
  epoch: 0,
}

export type WatchHomeState = {
  model: WatchHomeModel | null
  /**
   * Where the recommendations shelf belongs in `model.sections`, as the
   * published Experience authored it. Null when the block is absent or the body
   * fell back to the config model.
   */
  recommendationsInsertIndex: number | null
  /** No model painted yet (neither network nor snapshot) — the spinner gate. */
  loading: boolean
  refreshing: boolean
  error: string | null
  /** Network-only refetch suited to pull-to-refresh. */
  refetch: () => void
}

/** Fire-and-forget; an empty response never overwrites a good snapshot. */
function persistHomeSnapshot(
  videosJson: string,
  blocksJson: string,
  hydrationVideosJson: string,
  text: WatchHomeSnapshotText,
): void {
  const blob = serializeHomeSnapshotFromVideosJson(
    videosJson,
    new Date(),
    blocksJson,
    hydrationVideosJson,
    text,
  )
  if (blob.length > WATCH_HOME_SNAPSHOT_MAX_BYTES) return
  AsyncStorage.setItem(WATCH_HOME_SNAPSHOT_STORAGE_KEY, blob).catch(() => {
    // Write failures lose the fast next launch, nothing else.
    datadogLog.warn("home_snapshot.write_failed", {})
  })
}

type WatchSettingResult = {
  watchSetting?: {
    homepageExperience?: { blocks?: unknown } | null
  } | null
  englishWatchSetting?: {
    homepageExperience?: { blocks?: unknown } | null
  } | null
}

/** R11: the catalog tag's own homepage, else the `en` one. The source travels
 *  with the blocks, because the card precedence depends on it. */
function pickHomepage(
  data: WatchSettingResult | undefined,
): { blocks: ExperienceBlockList; homepageSource: HomepageSource } | null {
  const own = data?.watchSetting?.homepageExperience
  if (own != null) {
    return {
      blocks: own.blocks as ExperienceBlockList,
      homepageSource: "locale",
    }
  }
  const english = data?.englishWatchSetting?.homepageExperience
  if (english != null) {
    return {
      blocks: english.blocks as ExperienceBlockList,
      homepageSource: "en-fallback",
    }
  }
  return null
}

/**
 * Lean bulk home fetch with a requestId-ref stale-response guard. Stale-while-
 * revalidate: paint the prior launch's snapshot immediately (admin TTFB 2.5-6s),
 * revalidate in background. Unchanged response keeps the model (pager intact).
 */
export function useWatchHome(): WatchHomeState {
  const [body, setBody] = useState<WatchHomeBody>(EMPTY_BODY)
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
  // JSON of the painted snapshot's hydration (top-up) videos, so the keep-model
  // compare also detects a change in the coreId-hydration inputs.
  const snapshotHydrationJsonRef = useRef<string | null>(null)
  // The painted snapshot's homepage source: the same blocks under the other
  // source have another card precedence, so the keep-model compare reads it.
  const snapshotHomepageSourceRef = useRef<HomepageSource | null>(null)
  // Last Experience blocks that yielded >=1 shelf; reused when a transient
  // Experience fetch error would otherwise downgrade a good body to config (#1).
  const lastGoodExperienceRef = useRef<LastGoodExperience | null>(null)
  // Sibling of the above for hydration: last non-empty top-up records, reused when
  // a transient top-up failure would otherwise downgrade already-hydrated cards to
  // mux+slug, reset the hero pager (keep-model compare), and poison the snapshot.
  const lastGoodHydrationRef = useRef<LastGoodHydration | null>(null)
  // Home-ready fires once per (source, outcome) so the network paint's real
  // admin TTFB stays distinct from the ~50ms snapshot paint (R21).
  const homeReadySnapshotEmittedRef = useRef(false)
  // Success and failure latch separately: one shared ref meant a session that
  // failed then recovered never emitted the success paint, losing the real TTFB
  // for exactly the slow loads R21 exists to measure.
  const homeReadyNetworkEmittedRef = useRef(false)
  const homeReadyNetworkFailedEmittedRef = useRef(false)

  const fetchHome = useCallback(async (mode: "initial" | "refresh") => {
    const thisRequest = ++requestIdRef.current
    // KTD16: the forms and the epoch at the start. A response that lands in
    // another epoch is text in the old language, so it is dropped.
    const forms: AdminLanguageForms = currentAdminForms()
    const locale = forms.catalogTag
    const epochAtStart = getLocaleEpoch()
    const isStale = () =>
      requestIdRef.current !== thisRequest || getLocaleEpoch() !== epochAtStart
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
            ...videoTextVariables(forms),
          },
          fetchPolicy,
        }),
        withTimeout(
          client.query({
            query: GET_WATCH_SETTING,
            variables: localeQueryVariables(locale),
            fetchPolicy,
          }),
          EXPERIENCE_FETCH_DEADLINE_MS,
        ),
      ])
      if (isStale()) return

      // The required videos source failed — keep any painted model (snapshot
      // included) and surface a retry affordance, not a blank screen.
      if (videosOutcome.status === "rejected") {
        // R14/R22: record the failed required-videos load so slow/retried loads
        // stay in the home-ready distribution, not only fast successes.
        datadogLog.warn("watch_home.videos_failed", {})
        // Once per (source, outcome), NOT once per source: an ungated retry loop
        // skewed every rate/TTFB percentile, but sharing the success latch would
        // silently drop the recovery paint. Retry volume stays countable above.
        if (!homeReadyNetworkFailedEmittedRef.current) {
          homeReadyNetworkFailedEmittedRef.current = true
          datadogLog.info("home_feed_ready", {
            feed_source: "network",
            outcome: "failed",
          })
        }
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

      // Derive the Experience body. A transient Experience error (incl. the
      // deadline above) reuses the last-good blocks of THIS locale, so a network
      // blip can't downgrade a good body to config (#1), and a blip right after a
      // language change can't paint the old language's body (KTD16).
      let experienceBlocks: ExperienceBlockList | null = null
      let homepageSource: HomepageSource = "locale"
      let fallbackReason: WatchHomeFallbackReason = "null"
      if (experienceOutcome.status === "rejected") {
        // R14: the ~8s Experience deadline tripped (or the query rejected) —
        // the client gave up and the body degrades to last-good/config.
        datadogLog.warn("watch_home.experience_deadline", {})
        fallbackReason = "error"
        const lastGood = lastGoodExperienceRef.current
        if (lastGood != null && lastGood.locale === locale) {
          experienceBlocks = lastGood.blocks
          homepageSource = lastGood.homepageSource
        }
      } else {
        const homepage = pickHomepage(
          experienceOutcome.value.data as WatchSettingResult | undefined,
        )
        if (homepage != null) {
          experienceBlocks = homepage.blocks
          homepageSource = homepage.homepageSource
        }
      }
      // Hydrate the Experience cards by coreId: top-up the divergent coreIds the
      // config pool doesn't cover (e.g. the "Acts of the Apostles" episodes, whose
      // items carry no authored title/image). A slow/failed top-up reuses the
      // last-good records of this locale (so a blip can't downgrade hydrated cards,
      // reset the hero pager, or poison the snapshot) and logs topup-error. The
      // config model is built from `videos` only inside assembleWatchHomeModel.
      let hydrationVideos: readonly WatchHomeVideoInput[] = []
      let topUpFailed = false
      if (experienceBlocks != null) {
        const configIndex = buildVideoByCoreIdIndex(videos)
        const divergent = experienceItemCoreIds(experienceBlocks).filter(
          (coreId) => !configIndex.has(coreId),
        )
        if (divergent.length > 0) {
          let outcome: TopUpOutcome
          try {
            // cache-first even on pull-to-refresh: hydration title/art for a
            // static under-curated coreId set doesn't need forced network the way
            // the primary hero/shelf content does (the Experience fetch, which
            // carries the authored overrides, already refreshes on network-only).
            const fresh = await withTimeout(
              fetchTopUpVideos(client, divergent, "cache-first", forms),
              TOPUP_FETCH_DEADLINE_MS,
            )
            // The single post-allSettled guard does not cover this new await.
            if (isStale()) return
            outcome = { ok: true, videos: fresh }
          } catch {
            if (isStale()) return
            topUpFailed = true
            outcome = { ok: false }
          }
          // Last-good reuse on failure (pure, tested) — a transient blip can't
          // downgrade hydrated cards, reset the hero pager, or poison the snapshot.
          const resolved = resolveHydrationVideos(
            outcome,
            lastGoodHydrationFor(lastGoodHydrationRef.current, locale),
          )
          hydrationVideos = resolved.hydrationVideos
          lastGoodHydrationRef.current =
            resolved.nextLastGood != null
              ? { locale, videos: resolved.nextLastGood }
              : null
        }
      }
      const {
        model: nextModel,
        usedExperience,
        recommendationsInsertIndex,
      } = assembleWatchHomeModel({
        configVideos: videos,
        hydrationVideos,
        blocks: experienceBlocks,
        forms,
        homepageSource,
      })
      // A resolved Experience mapping to zero shelves is "empty", not an error —
      // the config fallback still logs a distinct reason (a reused-on-error body
      // keeps "error").
      if (
        experienceOutcome.status === "fulfilled" &&
        experienceBlocks != null &&
        !usedExperience
      ) {
        fallbackReason = "empty"
      }
      // Remember blocks that produced a real body for the next transient error.
      if (usedExperience && experienceBlocks != null) {
        lastGoodExperienceRef.current = {
          locale,
          homepageSource,
          blocks: experienceBlocks,
        }
      }
      // The painted body's source, tagged: Experience blocks when it won, else
      // "null" (config body). Persisted so cold launch repaints the same source.
      const blocksJson =
        usedExperience && experienceBlocks != null
          ? JSON.stringify(experienceBlocks)
          : "null"
      const paintedSource: HomepageSource = usedExperience
        ? homepageSource
        : "locale"
      const hydrationVideosJson = JSON.stringify(hydrationVideos)
      // Keep the painted snapshot model when the config videos, the body source,
      // the homepage source, AND the hydration inputs are all unchanged — avoids
      // resetting the hero pager on a no-op revalidation, while still repainting
      // when hydration lands.
      const snapshotStillCurrent =
        mode === "initial" &&
        videosJson === snapshotVideosJsonRef.current &&
        blocksJson === snapshotBlocksJsonRef.current &&
        hydrationVideosJson === snapshotHydrationJsonRef.current &&
        paintedSource === snapshotHomepageSourceRef.current
      if (!snapshotStillCurrent) {
        setBody({
          model: nextModel,
          recommendationsInsertIndex,
          epoch: epochAtStart,
        })
      }
      if (!homeReadyNetworkEmittedRef.current) {
        // R21: the network paint carries the real admin TTFB. `outcome` is
        // explicit so failed/(failed+success) can be computed — an absent
        // attribute would make every success row unmatchable.
        homeReadyNetworkEmittedRef.current = true
        datadogLog.info("home_feed_ready", {
          feed_source: "network",
          outcome: "success",
        })
      }
      if (!usedExperience) {
        logWatchHomeFallback({ reason: fallbackReason })
      } else if (experienceOutcome.status === "rejected") {
        // Reused last-good over a live Experience error — still logged so a
        // prolonged endpoint outage isn't silent behind a cached body (R11).
        logWatchHomeFallback({ reason: "error-recovered" })
      }
      // Never-silent: a dropped hydration top-up is logged even when the body
      // otherwise rendered from the live Experience.
      if (topUpFailed) logWatchHomeFallback({ reason: "topup-error" })
      // KTD16: a snapshot is written only for the locale on screen.
      if (videos.length > 0 && locale === getCatalogTag()) {
        persistHomeSnapshot(videosJson, blocksJson, hydrationVideosJson, {
          locale,
          homepageSource: paintedSource,
        })
      }
    } catch {
      if (isStale()) return
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

  // KTD16 and AE6: a new UI locale shows no old-language content. The body
  // clears to the loading state at once, and the new locale's fetch starts; a
  // response still in flight for the old epoch is dropped by `isStale`.
  const epoch = useLocaleEpoch()
  const fetchedEpochRef = useRef(epoch)
  useEffect(() => {
    if (fetchedEpochRef.current === epoch) return
    fetchedEpochRef.current = epoch
    requestIdRef.current += 1
    snapshotVideosJsonRef.current = null
    snapshotBlocksJsonRef.current = null
    snapshotHydrationJsonRef.current = null
    snapshotHomepageSourceRef.current = null
    setBody(EMPTY_BODY)
    void fetchHome("initial")
  }, [epoch, fetchHome])

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
        // KTD16: a snapshot in another locale is text in another language.
        if (snapshot.locale !== getCatalogTag()) return
        // Rebuild the exact painted source: config body/hero from the config
        // videos (no hero leak), Experience shelves hydrated off the merged index.
        const {
          model: snapshotModel,
          usedExperience,
          recommendationsInsertIndex,
        } = assembleWatchHomeModel({
          configVideos: snapshot.videos,
          hydrationVideos: snapshot.hydrationVideos,
          blocks: snapshot.blocks,
          forms: adminFormsFor(snapshot.locale),
          homepageSource: snapshot.homepageSource,
        })
        if (cancelled || networkLandedRef.current) return
        if (snapshot.locale !== getCatalogTag()) return
        snapshotVideosJsonRef.current = JSON.stringify(snapshot.videos)
        snapshotBlocksJsonRef.current = snapshot.blocks
          ? JSON.stringify(snapshot.blocks)
          : "null"
        snapshotHydrationJsonRef.current = JSON.stringify(
          snapshot.hydrationVideos,
        )
        snapshotHomepageSourceRef.current = snapshot.homepageSource
        // Seed last-good from the snapshot so a transient network Experience
        // error right after a cold-launch paint keeps the snapshot body (#1), and
        // the hydration sibling so a transient top-up failure keeps hydrated cards.
        if (usedExperience && snapshot.blocks) {
          lastGoodExperienceRef.current = {
            locale: snapshot.locale,
            homepageSource: snapshot.homepageSource,
            blocks: snapshot.blocks,
          }
        }
        if (snapshot.hydrationVideos.length > 0) {
          lastGoodHydrationRef.current = {
            locale: snapshot.locale,
            videos: snapshot.hydrationVideos,
          }
        }
        setBody({
          model: snapshotModel,
          recommendationsInsertIndex,
          epoch: getLocaleEpoch(),
        })
        if (!homeReadySnapshotEmittedRef.current) {
          homeReadySnapshotEmittedRef.current = true
          datadogLog.info("home_feed_ready", { feed_source: "snapshot" })
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

  // The render the epoch change causes comes before the clear effect, so the
  // old body is hidden here too; that frame shows the loading state instead.
  const oldBody = body.model != null && body.epoch !== epoch
  return {
    model: oldBody ? null : body.model,
    recommendationsInsertIndex: oldBody
      ? null
      : body.recommendationsInsertIndex,
    loading: loading || oldBody,
    refreshing,
    error,
    refetch,
  }
}

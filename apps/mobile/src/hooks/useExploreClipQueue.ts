/**
 * The Explore clip queue host (U22, KTD6, KTD8). It runs U5's pure queue
 * against the stored pool, the hydration query, U21's timing source, U6's clip
 * record, and Explore's own recommendations instance, and it starts nothing
 * before the tab's first focus (R46). The feed owns the reducer; this hook
 * hands it one computed clip at a time through `onClip`.
 */
import type { ApolloClient } from "@apollo/client"
import { Image } from "expo-image"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AppState } from "react-native"

import { useWatchPreferences } from "../contexts/WatchPreferencesProvider"
import {
  getApolloClient,
  isUnreachableEndpointError,
} from "../lib/apolloClient"
import {
  CLIP_QUEUE_AHEAD,
  advance,
  applyHydration,
  applyRelease,
  applyTiming,
  changeLanguage,
  createClipQueue,
  hydrationFailed,
  needsRetry,
  newVisit,
  nextStorableClip,
  poolFailed,
  retry,
  seedClip,
  setPool,
  setSlate,
  takeClip,
  type CandidateMedia,
  type ClipQueueContext,
  type ClipQueueEffect,
  type ClipQueueRecord,
  type ClipQueueSignal,
  type ClipQueueState,
} from "../lib/explore/clipQueue"
import { readAppVersion } from "../lib/explore/appVersion"
import {
  getClipRecordStore,
  type ClipRecordStore,
} from "../lib/explore/clipRecord"
import {
  eligibleStartsSlot,
  getClipTimingSource,
  type ClipTimingSource,
} from "../lib/explore/clipTiming"
import type { RandomSource } from "../lib/explore/clipWindow"
import {
  readDeviceLocale,
  resolveFeedLanguage,
} from "../lib/explore/feedLanguage"
import type { PlayerMode } from "../lib/explore/playerMode"
import {
  EXPLORE_INVENTORY_LIMIT,
  getExplorePoolStore,
  planPoolLoad,
  projectInventory,
  usableStoredClip,
  type ExplorePool,
  type ExplorePoolStore,
  type StoredReadyClip,
} from "../lib/explore/pool"
import {
  EXPLORE_VISIT_TIMEOUT_MS,
  type ExplorePoolState,
} from "../lib/explore/telemetry"
import type { ClipTier, FeedClip, ReadyClip } from "../lib/explore/types"
import { muxClipStillUrl } from "../lib/muxThumbnail"
import { EXPLORE_CLIP_CANDIDATES, EXPLORE_INVENTORY } from "../lib/queries"
import { RECOMMENDATION_UI_LOCALE } from "../lib/recommendations/context"
import type { DeliveryResult } from "../lib/recommendations/delivery"
import {
  getUserRecommendationsClient,
  useUserRecommendations,
  type UserRecommendationsClient,
} from "./useUserRecommendations"

/** KTD8: Explore's slate size on the `watch-for-you-v1` surface. */
export const EXPLORE_RECOMMENDATION_COUNT = 6

/** KTD8: at most one new slate request in this window. */
export const EXPLORE_DELIVERY_SPACING_MS = 10 * 60 * 1000

/** KTD8: delivery attempts per rolling hour, retries included. */
export const EXPLORE_DELIVERY_ATTEMPTS_PER_HOUR = 4

const HOUR_MS = 60 * 60 * 1000

/** The wait before the queue retries a failure by itself. The last one repeats. */
export const QUEUE_RETRY_DELAYS_MS: readonly number[] = [
  2_000, 5_000, 15_000, 30_000, 60_000,
]

/** Still URIs remembered for the loaded check. The oldest leave first. */
const MAX_TRACKED_STILLS = 16

/** What the wrapper answers for an attempt past the budget. No request goes out. */
const OVER_BUDGET: DeliveryResult = {
  kind: "unavailable",
  reason: "explore_budget",
  retryable: false,
}

// ── KTD8: the delivery budget ───────────────────────────────────────

export type SlateAdmission =
  | { kind: "now" }
  /** The spacing holds a new request until this epoch ms. */
  | { kind: "at"; at: number }
  /** The hour is spent. A refused hour is not retried. */
  | { kind: "never" }

export type ExploreDeliveryBudget = {
  /** Whether a new slate request may start at `now`. */
  admit: (now: number) => SlateAdmission
  /**
   * A client that counts each attempt and refuses one past KTD8's budget. It
   * sends no evidence and no selection, because those facts name Home's shelf.
   */
  wrap: (
    base: UserRecommendationsClient,
    hooks: { now: () => number; onProfileChange: () => void },
  ) => UserRecommendationsClient
}

/**
 * One budget per launch, not per hook instance: a remount must not buy a
 * second request inside the spacing.
 */
export function createExploreDeliveryBudget(): ExploreDeliveryBudget {
  let attempts: number[] = []
  let lastRequestAt: number | null = null
  let flight: { key: string; promise: Promise<DeliveryResult> } | null = null

  const attemptsInHour = (now: number): number => {
    attempts = attempts.filter((at) => now - at < HOUR_MS)
    return attempts.length
  }
  const spaced = (now: number): boolean =>
    lastRequestAt == null || now - lastRequestAt >= EXPLORE_DELIVERY_SPACING_MS

  function attempt(
    base: UserRecommendationsClient,
    input: Parameters<UserRecommendationsClient["fetch"]>[0],
    now: number,
  ): Promise<DeliveryResult> {
    const key = `${input.locale}:${input.audioLanguageSlug}:${input.count}`
    const first = input.attempt <= 1
    // A StrictMode re-run asks again at once; it shares the answer in flight.
    if (first && flight?.key === key) return flight.promise
    if (attemptsInHour(now) >= EXPLORE_DELIVERY_ATTEMPTS_PER_HOUR) {
      return Promise.resolve(OVER_BUDGET)
    }
    if (first && !spaced(now)) return Promise.resolve(OVER_BUDGET)
    attempts.push(now)
    let promise: Promise<DeliveryResult>
    try {
      promise = base.fetch(input)
    } catch (error) {
      promise = Promise.reject(error)
    }
    if (!first) return promise
    lastRequestAt = now
    const current = { key, promise }
    flight = current
    const release = () => {
      if (flight === current) flight = null
    }
    void promise.then(release, release)
    return promise
  }

  return {
    admit(now) {
      if (attemptsInHour(now) >= EXPLORE_DELIVERY_ATTEMPTS_PER_HOUR) {
        return { kind: "never" }
      }
      if (!spaced(now)) {
        return { kind: "at", at: lastRequestAt! + EXPLORE_DELIVERY_SPACING_MS }
      }
      return { kind: "now" }
    },

    wrap(base, hooks) {
      return {
        fetch: (input) => attempt(base, input, hooks.now()),
        recordEvidence: () => Promise.resolve(undefined),
        select: () => Promise.reject(new Error("Explore sends no selection")),
        // The hook schedules the refetch itself, inside the budget.
        subscribeProfile: () =>
          base.subscribeProfile?.(hooks.onProfileChange) ?? (() => {}),
        now: base.now,
      }
    },
  }
}

const exploreDeliveryBudget = createExploreDeliveryBudget()

// ── Dependencies ────────────────────────────────────────────────────

export type ExploreQueryClient = Pick<ApolloClient, "query">

export type ExploreClipQueueDeps = {
  /** Called for each request, never at module scope. */
  getClient: () => ExploreQueryClient
  classifyFailure: (error: unknown) => "unreachable" | "transient"
  poolStore: Pick<
    ExplorePoolStore,
    "readPool" | "writePool" | "readReadyClip" | "writeReadyClip"
  >
  record: ClipQueueRecord &
    Pick<
      ClipRecordStore,
      "hydrate" | "releaseOldestForLanguage" | "setGestureActive" | "flushNow"
    >
  timing: Pick<
    ClipTimingSource,
    "hydrate" | "acquire" | "resetVisit" | "setGestureActive" | "flushNow"
  >
  eligibleStartsSlot: ClipQueueContext["eligibleStartsSlot"]
  recommendations: UserRecommendationsClient
  budget: ExploreDeliveryBudget
  /** Resolves true when the image is in expo-image's cache. */
  prefetchImage: (uri: string) => Promise<boolean>
  random: RandomSource
  now: () => number
  deviceLocale: () => string | null
}

let defaultDeps: ExploreClipQueueDeps | null = null

/** The app's stores and clients. Building them makes no request. */
export function getExploreClipQueueDeps(): ExploreClipQueueDeps {
  defaultDeps ??= {
    getClient: getApolloClient,
    classifyFailure: (error) =>
      isUnreachableEndpointError(error) ? "unreachable" : "transient",
    poolStore: getExplorePoolStore(),
    record: getClipRecordStore(),
    timing: getClipTimingSource(readAppVersion()),
    eligibleStartsSlot,
    recommendations: getUserRecommendationsClient(),
    budget: exploreDeliveryBudget,
    prefetchImage: (uri) =>
      Image.prefetch([uri], { cachePolicy: "memory-disk" }),
    random: Math.random,
    now: Date.now,
    deviceLocale: readDeviceLocale,
  }
  return defaultDeps
}

// ── The hook's contract ─────────────────────────────────────────────

/** The queue took a clip from a lower tier, or released record entries. */
export type PoolFallbackReport = {
  tier: ClipTier
  feedLanguageSlug: string
  releasedEntries: number
}

export type UseExploreClipQueueInput = {
  /** R46: the tab's first-focus latch. Nothing starts before it. */
  hasFocused: boolean
  /** The tab is on screen now. A return after 30 min starts a new visit. */
  focused: boolean
  /** KTD22: the pager's latch. No queue step runs while it is set. */
  gestureActive: boolean
  /**
   * KTD6: true until the first clip moves. The queue then computes only a
   * first clip, so no look-ahead request competes with the first load.
   */
  holdLookahead?: boolean
  /** `feedState.playerMode`. One-player mode prefetches stills (KTD21). */
  playerMode: PlayerMode
  /** `needsClip(feedState)`. The hook then hands over one clip. */
  wantsClip: boolean
  /** `feedState.queued != null`. */
  feedHoldsQueued: boolean
  /** `currentClip(feedState)`. */
  currentClip: FeedClip | null
  /** `nextClip(feedState)`. Its still is prefetched in one-player mode. */
  nextClip: FeedClip | null
  /** The feed dispatches `clipQueued` with this clip. */
  onClip: (clip: ReadyClip) => void
  /** First-motion stage: the first pool is ready, stored or fetched. */
  onPoolReady?: (poolState: ExplorePoolState) => void
  onPoolFallback?: (report: PoolFallbackReport) => void
}

export type ExploreClipQueue = {
  /** R19: the one slug for eligibility, the pool, and the slate. */
  feedLanguageSlug: string
  /** R37 / R47. The feed dispatches `offline` or `empty` while preparing. */
  signal: ClipQueueSignal | null
  /** The offline retry. It fetches the pool again when there is none. */
  retry: () => void
  /** Null until the first pool is ready. */
  poolState: ExplorePoolState | null
  /** The current clip's time-offset still, in one-player mode only. */
  stillUri: string | null
  /** True once `stillUri` is in the image cache. */
  stillLoaded: boolean
}

// ── The engine ──────────────────────────────────────────────────────

type PumpInput = Pick<
  UseExploreClipQueueInput,
  | "wantsClip"
  | "feedHoldsQueued"
  | "gestureActive"
  | "holdLookahead"
  | "currentClip"
  | "playerMode"
>

type Callbacks = Pick<
  UseExploreClipQueueInput,
  "onClip" | "onPoolReady" | "onPoolFallback"
>

type EngineHost = {
  callbacks: () => Callbacks
  /** Re-render, so the pump runs again with the feed's current props. */
  requestPump: () => void
  setSignal: (signal: ClipQueueSignal | null) => void
  setPoolState: (poolState: ExplorePoolState) => void
  markStillLoaded: (uri: string) => void
  /** `changeLanguage`'s `refreshRecommendations` effect. */
  refreshSlate: (languageSlug: string) => void
}

type Apply = (state: ClipQueueState) => ClipQueueState

function clipTier(clip: ReadyClip): ClipTier {
  if (clip.subtitleOnly) return "subtitleOnly"
  return clip.cut === "fallback" ? "fallbackDubbed" : "sentenceDubbed"
}

function stillUriOf(clip: FeedClip): string | null {
  return muxClipStillUrl(clip.muxPlaybackId, clip.window.startSeconds)
}

/**
 * The queue loop. It lives for the hook instance, so a StrictMode cycle keeps
 * it; `suspend` and `resume` bracket that cycle, and after a real unmount
 * every late answer is dropped.
 */
function createQueueEngine(deps: ExploreClipQueueDeps, host: EngineHost) {
  let alive = true
  let queue: ClipQueueState | null = null
  let recordLanded: Promise<void> = Promise.resolve()
  let recordReady = false
  /** One queue effect at a time, a stale one included (KTD6). */
  let busy = false
  let effectAbort: AbortController | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retryStep = 0
  let latched = false
  let poolReported = false
  const poolFlights = new Map<string, Promise<void>>()
  /** Videos whose hydration made a clip; each is released when its clip leaves. */
  let producedIds = new Set<string>()
  let releasedSinceClip = 0
  let storedClip: ReadyClip | null = null
  let appliedRequestId: string | null = null
  /** The feed slots at the last hand-off: a feed that ignores a clip gets no second one. */
  let handOffMark: { current: FeedClip | null; queued: boolean } | null = null
  const stillsAsked: string[] = []

  const current = (slug: string): boolean =>
    alive && queue != null && queue.feedLanguageSlug === slug

  // KTD22: a result that lands during a gesture waits for the release.
  function wake(): void {
    if (alive && !latched) host.requestPump()
  }

  function clearRetry(): void {
    if (retryTimer != null) clearTimeout(retryTimer)
    retryTimer = null
  }

  function applyPool(pool: ExplorePool, poolState: ExplorePoolState): void {
    if (queue == null) return
    // A background refresh can land before the stored pool is applied.
    if (queue.pool != null && queue.pool.fetchedAt > pool.fetchedAt) return
    queue = setPool(queue, pool, deps.random)
    retryStep = 0
    if (poolReported) return
    poolReported = true
    host.setPoolState(poolState)
    host.callbacks().onPoolReady?.(poolState)
  }

  function fetchPool(slug: string): void {
    if (poolFlights.has(slug)) return
    const flight = (async () => {
      let pool: ExplorePool | null = null
      let failure: "unreachable" | "transient" = "transient"
      try {
        const result = await deps.getClient().query({
          query: EXPLORE_INVENTORY,
          variables: { languageSlug: slug, limit: EXPLORE_INVENTORY_LIMIT },
          fetchPolicy: "no-cache",
        })
        if (result.error) throw result.error
        const inventory = result.data?.watchLanguageInventory
        if (inventory != null) {
          pool = projectInventory(inventory, slug, deps.now())
        }
      } catch (error) {
        failure = deps.classifyFailure(error)
      }
      if (!current(slug) || queue == null) return
      if (pool == null) {
        queue = poolFailed(queue, failure)
      } else {
        void deps.poolStore.writePool(pool)
        applyPool(pool, "cold")
      }
      wake()
    })()
    poolFlights.set(slug, flight)
    const release = () => {
      if (poolFlights.get(slug) === flight) poolFlights.delete(slug)
    }
    void flight.then(release, release)
  }

  /** The stored pool first; a fetch when it is missing or old (KTD6). */
  async function loadPool(slug: string, warmOpen: boolean): Promise<void> {
    const [stored, readyClip] = await Promise.all([
      deps.poolStore.readPool(slug),
      warmOpen
        ? deps.poolStore.readReadyClip()
        : Promise.resolve<StoredReadyClip | null>(null),
    ])
    if (!current(slug)) return
    const plan = planPoolLoad(stored, deps.now())
    if (plan.fetch !== "none") fetchPool(slug)
    const pool = plan.use
    if (pool == null) return
    // The stored clip is checked against the record, so the record lands first.
    await recordLanded
    if (!current(slug) || queue == null) return
    applyPool(pool, "warm")
    const clip = usableStoredClip(readyClip, {
      feedLanguageSlug: slug,
      poolFetchedAt: pool.fetchedAt,
      recordedWindows: (videoId) => deps.record.getWindows(videoId),
    })
    if (clip != null) {
      queue = seedClip(queue, clip)
      storedClip = clip
    }
    wake()
  }

  function scheduleRetry(): void {
    if (retryTimer != null) return
    const delay =
      QUEUE_RETRY_DELAYS_MS[
        Math.min(retryStep, QUEUE_RETRY_DELAYS_MS.length - 1)
      ]
    retryStep += 1
    retryTimer = setTimeout(() => {
      retryTimer = null
      retryQueue()
    }, delay)
  }

  function retryQueue(): void {
    if (!alive || queue == null) return
    queue = retry(queue)
    if (queue.pool == null) fetchPool(queue.feedLanguageSlug)
    wake()
  }

  async function hydrate(
    effect: Extract<ClipQueueEffect, { kind: "hydrate" }>,
    signal: AbortSignal,
  ): Promise<Apply> {
    try {
      const result = await deps.getClient().query({
        query: EXPLORE_CLIP_CANDIDATES,
        variables: {
          coreIds: [...effect.coreIds],
          audioLanguageSlug: effect.audioLanguageSlug,
        },
        fetchPolicy: "no-cache",
        context: { fetchOptions: { signal } },
      })
      if (result.error) throw result.error
      const videos = result.data?.watchHomeVideos
      // No body is not an answer: every candidate would read as ineligible.
      if (videos == null) {
        return (state) => hydrationFailed(state, effect.token, "transient")
      }
      return (state) => applyHydration(state, effect.token, videos)
    } catch (error) {
      const reason = deps.classifyFailure(error)
      return (state) => hydrationFailed(state, effect.token, reason)
    }
  }

  function run(effect: ClipQueueEffect): void {
    if (queue == null) return
    if (effect.kind === "release") {
      releasedSinceClip += deps.record.releaseOldestForLanguage(
        effect.languageSlug,
        effect.count,
      )
      queue = applyRelease(queue, effect.token)
      wake()
      return
    }
    busy = true
    const controller = new AbortController()
    effectAbort = controller
    const settle = (apply: Apply) => {
      if (effectAbort === controller) effectAbort = null
      if (!alive || queue == null) return
      busy = false
      queue = apply(queue)
      wake()
    }
    if (effect.kind === "hydrate") {
      void hydrate(effect, controller.signal).then(settle)
      return
    }
    void deps.timing
      .acquire({ ...effect.request, signal: controller.signal })
      .then(
        (result) => settle((state) => applyTiming(state, effect.token, result)),
        () =>
          settle((state) =>
            applyTiming(state, effect.token, {
              status: "transient",
              reason: "network_error",
            }),
          ),
      )
  }

  function reportNewClips(before: ClipQueueState, after: ClipQueueState): void {
    const fresh = after.ahead.slice(before.ahead.length)
    for (const clip of fresh) {
      producedIds.add(clip.videoId)
      retryStep = 0
      const tier = clipTier(clip)
      if (tier !== "sentenceDubbed" || releasedSinceClip > 0) {
        host.callbacks().onPoolFallback?.({
          tier,
          feedLanguageSlug: clip.feedLanguageSlug,
          releasedEntries: releasedSinceClip,
        })
      }
      releasedSinceClip = 0
    }
  }

  /** KTD6: a hydration leaves when its clip leaves the queue and the current slot. */
  function releaseHydrations(input: PumpInput): void {
    if (queue == null || producedIds.size === 0) return
    const held = new Set(queue.ahead.map((clip) => clip.videoId))
    if (input.feedHoldsQueued && queue.handedOff != null) {
      held.add(queue.handedOff.videoId)
    }
    if (input.currentClip != null) held.add(input.currentClip.videoId)
    let media: Map<string, CandidateMedia> | null = null
    for (const id of [...producedIds]) {
      if (held.has(id)) continue
      producedIds.delete(id)
      if (!queue.media.has(id)) continue
      media ??= new Map(queue.media)
      media.delete(id)
    }
    if (media != null) queue = { ...queue, media }
  }

  function storeNextClip(): void {
    if (queue == null) return
    const next = nextStorableClip(queue)
    if (next == null || next === storedClip) return
    storedClip = next
    void deps.poolStore.writeReadyClip(next, deps.now())
  }

  function prefetchStill(clip: FeedClip): void {
    const uri = stillUriOf(clip)
    if (uri == null || stillsAsked.includes(uri)) return
    stillsAsked.push(uri)
    if (stillsAsked.length > MAX_TRACKED_STILLS) stillsAsked.shift()
    let request: Promise<boolean>
    try {
      request = deps.prefetchImage(uri)
    } catch {
      return
    }
    void request.then(
      (loaded) => {
        if (loaded && alive) host.markStillLoaded(uri)
      },
      () => {},
    )
  }

  /** Hands over one clip. Allowed during a gesture: it is a pop, not a search. */
  function handOff(input: PumpInput): boolean {
    if (queue == null || !input.wantsClip || queue.ahead.length === 0) {
      return false
    }
    const mark = handOffMark
    if (
      mark != null &&
      mark.current === input.currentClip &&
      mark.queued === input.feedHoldsQueued
    ) {
      return false
    }
    const taken = takeClip(queue)
    if (taken.clip == null) return false
    queue = taken.state
    handOffMark = {
      current: input.currentClip,
      queued: input.feedHoldsQueued,
    }
    host.callbacks().onClip(taken.clip)
    if (input.playerMode === "one") prefetchStill(taken.clip)
    return true
  }

  /**
   * Under the look-ahead hold, the first clip fills the queue: `advance` can
   * start the next request in the same call that cuts a clip, so a skipped
   * pump alone would not stop it.
   */
  function clipsAheadInFeed(input: PumpInput): number {
    if (input.holdLookahead !== true) return input.feedHoldsQueued ? 1 : 0
    return CLIP_QUEUE_AHEAD - 1 + (queue?.handedOff != null ? 1 : 0)
  }

  function step(input: PumpInput): void {
    if (queue == null) return
    const before = queue
    const result = advance(queue, {
      random: deps.random,
      record: deps.record,
      eligibleStartsSlot: deps.eligibleStartsSlot,
      clipsAheadInFeed: clipsAheadInFeed(input),
    })
    queue = result.state
    reportNewClips(before, queue)
    host.setSignal(result.signal)
    if (result.effect != null) {
      run(result.effect)
      return
    }
    // The viewer's retry answers "offline"; every other failure retries itself.
    if (result.signal == null && needsRetry(queue)) scheduleRetry()
    if (input.wantsClip && queue.ahead.length > before.ahead.length) wake()
  }

  return {
    started: (): boolean => queue != null,

    /** The first focus: the record, the timing verdicts, and the pool together. */
    start(slug: string): void {
      if (queue != null) return
      queue = createClipQueue(slug)
      recordLanded = deps.record.hydrate()
      void deps.timing.hydrate()
      void recordLanded.then(() => {
        recordReady = true
        wake()
      })
      void loadPool(slug, true)
    },

    resume(): void {
      alive = true
      if (queue != null) host.requestPump()
    },

    /** A timer is not an answer: cleared here, re-armed by the next pump. */
    suspend(): void {
      alive = false
      clearRetry()
    },

    pump(input: PumpInput): void {
      latched = input.gestureActive
      if (!alive || queue == null) return
      if (handOff(input)) {
        host.requestPump()
        return
      }
      if (input.gestureActive || !recordReady) return
      releaseHydrations(input)
      if (!busy) step(input)
      storeNextClip()
    },

    /** R24: the clips the feed holds stay; one pool fetch and one slate request. */
    changeLanguage(slug: string): void {
      if (queue == null) return
      const change = changeLanguage(queue, slug)
      if (change.effects.length === 0) return
      queue = change.state
      // Its answer is stale now; `busy` holds the next request until it settles.
      effectAbort?.abort()
      producedIds = new Set()
      releasedSinceClip = 0
      clearRetry()
      retryStep = 0
      for (const effect of change.effects) {
        if (effect.kind === "fetchPool") {
          void loadPool(effect.languageSlug, false)
        } else {
          host.refreshSlate(effect.languageSlug)
        }
      }
      wake()
    },

    /** A served slate for the feed language, applied once per request. */
    applySlate(
      slug: string,
      requestId: string,
      videoIds: readonly string[],
    ): void {
      if (queue == null || queue.feedLanguageSlug !== slug) return
      if (appliedRequestId === requestId) return
      appliedRequestId = requestId
      queue = setSlate(queue, videoIds)
      wake()
    },

    /** A profile transition: the old slate must not order another clip. */
    clearSlate(): void {
      if (queue != null) queue = setSlate(queue, null)
    },

    retryNow(): void {
      clearRetry()
      retryStep = 0
      retryQueue()
    },

    /** KTD24's probe budget is per visit. */
    newVisit(): void {
      if (queue != null) queue = newVisit(queue)
      deps.timing.resetVisit()
    },

    prefetchStill,
  }
}

type QueueEngine = ReturnType<typeof createQueueEngine>

// ── KTD8: the slate scheduler ───────────────────────────────────────

/**
 * Holds one wanted slate request until the budget admits it. Only an admitted
 * request changes the inner hook's options or calls its refresh.
 */
function createSlateScheduler(
  deps: ExploreClipQueueDeps,
  host: {
    requestedSlug: () => string | null
    requestSlug: (slug: string) => void
    refresh: () => void
  },
) {
  let wanted: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let alive = true

  function clearTimer(): void {
    if (timer != null) clearTimeout(timer)
    timer = null
  }

  function tryRequest(): void {
    const slug = wanted
    if (!alive || slug == null || timer != null) return
    const now = deps.now()
    const admission = deps.budget.admit(now)
    if (admission.kind === "never") {
      wanted = null
      return
    }
    if (admission.kind === "at") {
      timer = setTimeout(
        () => {
          timer = null
          tryRequest()
        },
        Math.max(0, admission.at - now),
      )
      return
    }
    wanted = null
    if (host.requestedSlug() === slug) host.refresh()
    else host.requestSlug(slug)
  }

  return {
    want(slug: string): void {
      wanted = slug
      clearTimer()
      tryRequest()
    },
    resume(): void {
      alive = true
      tryRequest()
    },
    suspend(): void {
      alive = false
      clearTimer()
    },
  }
}

// ── The hook ────────────────────────────────────────────────────────

export function useExploreClipQueue(
  input: UseExploreClipQueueInput,
  deps: ExploreClipQueueDeps = getExploreClipQueueDeps(),
): ExploreClipQueue {
  const {
    hasFocused,
    focused,
    gestureActive,
    holdLookahead,
    playerMode,
    wantsClip,
    feedHoldsQueued,
    currentClip,
    nextClip,
  } = input
  // The first render's deps serve the hook's whole life.
  const [d] = useState(deps)
  const { audioLanguageSlug } = useWatchPreferences()
  const feedLanguageSlug = useMemo(
    () =>
      resolveFeedLanguage({
        preferredAudioSlug: audioLanguageSlug,
        deviceLocale: d.deviceLocale(),
      }),
    [audioLanguageSlug, d],
  )

  const [tick, setTick] = useState(0)
  const [signal, setSignal] = useState<ClipQueueSignal | null>(null)
  const [poolState, setPoolState] = useState<ExplorePoolState | null>(null)
  const [loadedStills, setLoadedStills] = useState<readonly string[]>([])

  const callbacksRef = useRef<Callbacks>(input)
  const feedSlugRef = useRef(feedLanguageSlug)
  const refreshSlateRef = useRef<(slug: string) => void>(() => {})
  const profileChangeRef = useRef<() => void>(() => {})
  const innerRefreshRef = useRef<() => void>(() => {})

  const [engine] = useState<QueueEngine>(() =>
    createQueueEngine(d, {
      callbacks: () => callbacksRef.current,
      requestPump: () => setTick((value) => value + 1),
      setSignal,
      setPoolState,
      markStillLoaded: (uri) =>
        setLoadedStills((held) =>
          held.includes(uri)
            ? held
            : [...held.slice(1 - MAX_TRACKED_STILLS), uri],
        ),
      refreshSlate: (slug) => refreshSlateRef.current(slug),
    }),
  )

  // ── KTD8: Explore's own slate ────────────────────────────────────
  const [requestedSlug, setRequestedSlug] = useState<string | null>(null)
  const requestedSlugRef = useRef<string | null>(null)
  const [client] = useState(() =>
    d.budget.wrap(d.recommendations, {
      now: d.now,
      onProfileChange: () => profileChangeRef.current(),
    }),
  )
  const recommendations = useUserRecommendations(
    {
      locale: RECOMMENDATION_UI_LOCALE,
      audioLanguageSlug: requestedSlug ?? feedLanguageSlug,
      count: EXPLORE_RECOMMENDATION_COUNT,
      // Nothing is sent until the budget admits the first request.
      enabled: requestedSlug != null,
    },
    client,
  )
  const [scheduler] = useState(() =>
    createSlateScheduler(d, {
      requestedSlug: () => requestedSlugRef.current,
      requestSlug: (slug) => {
        requestedSlugRef.current = slug
        setRequestedSlug(slug)
      },
      refresh: () => innerRefreshRef.current(),
    }),
  )

  useEffect(() => {
    callbacksRef.current = {
      onClip: input.onClip,
      onPoolReady: input.onPoolReady,
      onPoolFallback: input.onPoolFallback,
    }
    innerRefreshRef.current = recommendations.refresh
    refreshSlateRef.current = (slug) => scheduler.want(slug)
    profileChangeRef.current = () => {
      // R46: the viewer store can report a change before the first focus.
      if (!engine.started()) return
      engine.clearSlate()
      scheduler.want(feedSlugRef.current)
    }
  })

  // Setup restores what the cleanup suspends: StrictMode runs setup, cleanup,
  // setup on this same instance.
  useEffect(() => {
    engine.resume()
    scheduler.resume()
    return () => {
      engine.suspend()
      scheduler.suspend()
    }
  }, [engine, scheduler])

  // R46: the first focus starts the queue; a later slug is a language change.
  useEffect(() => {
    if (!hasFocused) return
    feedSlugRef.current = feedLanguageSlug
    if (engine.started()) {
      engine.changeLanguage(feedLanguageSlug)
      return
    }
    engine.start(feedLanguageSlug)
    scheduler.want(feedLanguageSlug)
  }, [engine, scheduler, hasFocused, feedLanguageSlug])

  const served =
    recommendations.status === "served" ? recommendations.slate : null
  useEffect(() => {
    if (served == null || requestedSlug == null) return
    engine.applySlate(
      requestedSlug,
      served.requestId,
      served.items.map((item) => item.targetMediaId),
    )
  }, [engine, served, requestedSlug])

  // KTD22: the latch reaches both stores; an unmount never leaves them latched.
  useEffect(() => {
    if (!hasFocused) return
    d.timing.setGestureActive(gestureActive)
    d.record.setGestureActive(gestureActive)
    return () => {
      d.timing.setGestureActive(false)
      d.record.setGestureActive(false)
    }
  }, [d, hasFocused, gestureActive])

  useEffect(() => {
    if (!hasFocused) return
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "background") return
      void d.record.flushNow()
      void d.timing.flushNow()
    })
    return () => subscription.remove()
  }, [d, hasFocused])

  // KTD17's visit: a return after 30 min away starts a new one.
  const blurredAtRef = useRef<number | null>(null)
  useEffect(() => {
    if (!hasFocused) return
    if (!focused) {
      blurredAtRef.current ??= d.now()
      return
    }
    const blurredAt = blurredAtRef.current
    blurredAtRef.current = null
    if (blurredAt == null) return
    if (d.now() - blurredAt < EXPLORE_VISIT_TIMEOUT_MS) return
    engine.newVisit()
    scheduler.want(feedSlugRef.current)
  }, [d, engine, scheduler, hasFocused, focused])

  // KTD21: only one-player mode shows a still, so only it pays for one.
  useEffect(() => {
    if (hasFocused && playerMode === "one" && nextClip != null) {
      engine.prefetchStill(nextClip)
    }
  }, [engine, hasFocused, playerMode, nextClip])

  useEffect(() => {
    if (!hasFocused) return
    engine.pump({
      wantsClip,
      feedHoldsQueued,
      gestureActive,
      holdLookahead,
      currentClip,
      playerMode,
    })
  }, [
    engine,
    tick,
    hasFocused,
    wantsClip,
    feedHoldsQueued,
    gestureActive,
    holdLookahead,
    currentClip,
    playerMode,
  ])

  const retryQueue = useCallback(() => engine.retryNow(), [engine])
  const stillUri =
    playerMode === "one" && currentClip != null ? stillUriOf(currentClip) : null
  const stillLoaded = stillUri != null && loadedStills.includes(stillUri)

  return useMemo(
    () => ({
      feedLanguageSlug,
      signal,
      retry: retryQueue,
      poolState,
      stillUri,
      stillLoaded,
    }),
    [feedLanguageSlug, signal, retryQueue, poolState, stillUri, stillLoaded],
  )
}

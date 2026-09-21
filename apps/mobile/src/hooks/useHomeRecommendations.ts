/**
 * Home's recommendations controller (feat-517 KTD3, KTD4). Home hosts the
 * slate hook so the shelf stays a thin renderer: the shelf's first mount is
 * the only fetch trigger, a closed feed gate stops the slate, its expiry timer
 * and its evidence, and a blurred Home holds every refresh until focus
 * returns. The impression dwell tracker and its app-state listener live here
 * too, so every dwell timer belongs to one owner.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AppState } from "react-native"

import { useWatchPreferences } from "../contexts/WatchPreferencesProvider"
import { resolveRecommendationContext } from "../lib/recommendations/context"
import type {
  UserRecommendationSlate,
  UserRecommendationItem,
} from "../lib/recommendations/delivery"
import {
  createImpressionDwellTracker,
  isForegroundAppState,
  type ImpressionDwellTracker,
} from "../lib/recommendations/impressionDwell"
import { USER_RECOMMENDATION_DEFAULT_COUNT } from "../lib/recommendations/operations"
import type { SelectionResult } from "../lib/recommendations/selection"
import {
  getUserRecommendationsClient,
  useUserRecommendations,
  type UserRecommendationsClient,
  type UserRecommendationsStatus,
} from "./useUserRecommendations"

export type UseHomeRecommendationsOptions = {
  /** The feed gate (KTD9). False keeps the hook idle and drops the slate. */
  gateOpen: boolean
  /** Home's focus flag. A blurred Home holds every refresh (KTD3). */
  focused: boolean
}

export type HomeRecommendationsController = {
  status: UserRecommendationsStatus
  /** The last served slate, kept across a refetch so the row holds (R18). */
  slate: UserRecommendationSlate | null
  /** True while Home's list holds the row in the viewport (R8). */
  shelfInView: boolean
  /** The shelf calls this on its first mount; that latch starts the fetch. */
  reportShelfMounted: () => void
  /** Home's list reports the row at least half visible (KTD4). */
  reportShelfVisible: (visible: boolean) => void
  /** The row's list reports these card ids at least half visible (KTD4). */
  reportVisibleCards: (itemIds: readonly string[]) => void
  /** The row unmounted or was recycled: every card signal drops (KTD4). */
  reportShelfDetached: () => void
  recordRender: (itemId: string) => void
  recordImpression: (itemId: string) => void
  select: (itemId: string) => Promise<SelectionResult | null>
  /** The single entry point for every event-driven refetch. */
  refresh: () => void
}

const NOOP = () => {}

export function useHomeRecommendations(
  options: UseHomeRecommendationsOptions,
  client: UserRecommendationsClient = getUserRecommendationsClient(),
): HomeRecommendationsController {
  const { gateOpen, focused } = options
  const { audioLanguageSlug } = useWatchPreferences()
  const context = useMemo(
    () => resolveRecommendationContext({ audioLanguageSlug }),
    [audioLanguageSlug],
  )

  const focusedRef = useRef(focused)
  focusedRef.current = focused
  const heldRef = useRef(false)
  const shelfMountedRef = useRef(false)
  const innerRefreshRef = useRef<() => void>(NOOP)

  const runOrHold = useCallback((run: () => void) => {
    if (!focusedRef.current) {
      heldRef.current = true
      return
    }
    run()
  }, [])

  const refresh = useCallback(
    () => runOrHold(() => innerRefreshRef.current()),
    [runOrHold],
  )

  // The inner hook's own profile subscription is routed through the hold, so a
  // transition that lands while Home is blurred waits with every other trigger.
  const heldClient = useMemo<UserRecommendationsClient>(
    () => ({
      ...client,
      subscribeProfile: (listener) =>
        client.subscribeProfile?.(() => runOrHold(listener)) ?? NOOP,
    }),
    [client, runOrHold],
  )

  const [latched, setLatched] = useState(false)
  const reportShelfMounted = useCallback(() => {
    shelfMountedRef.current = true
    if (focusedRef.current) setLatched(true)
  }, [])

  useEffect(() => {
    if (!focused) return
    if (shelfMountedRef.current && !latched) {
      // The first fetch subsumes anything held while Home was blurred.
      heldRef.current = false
      setLatched(true)
      return
    }
    if (!heldRef.current) return
    heldRef.current = false
    innerRefreshRef.current()
  }, [focused, latched])

  const enabled = latched && gateOpen
  const recommendations = useUserRecommendations(
    {
      locale: context.locale,
      audioLanguageSlug: context.audioLanguageSlug,
      count: USER_RECOMMENDATION_DEFAULT_COUNT,
      enabled,
    },
    heldClient,
  )
  innerRefreshRef.current = recommendations.refresh

  // KTD6: the inner hook clears its slate at the start of every refetch, so the
  // last served one is held here and the shelf keeps its cards while it loads.
  const servedSlate = recommendations.slate
  const [displaySlate, setDisplaySlate] =
    useState<UserRecommendationSlate | null>(null)
  useEffect(() => {
    if (!enabled) {
      setDisplaySlate(null)
      return
    }
    if (servedSlate != null) setDisplaySlate(servedSlate)
  }, [enabled, servedSlate])

  // R16: past `expiresAt` the item capabilities are dead, so refresh rather
  // than let the shelf keep sending evidence Admin would reject.
  const expiresAt = displaySlate?.expiresAt ?? null
  useEffect(() => {
    if (!enabled || expiresAt == null) return
    const deadline = Date.parse(expiresAt)
    if (!Number.isFinite(deadline)) return
    const timer = setTimeout(refresh, Math.max(0, deadline - Date.now()))
    return () => clearTimeout(timer)
  }, [enabled, expiresAt, refresh])

  const { status, recordRender, recordImpression, select } = recommendations

  // ── The impression dwell (KTD4) ───────────────────────────────────────────

  // The tracker lives for the hook, not the render: its per-slate record of
  // what it already sent is the only bound on a second impression per card.
  const trackerRef = useRef<ImpressionDwellTracker | null>(null)
  const recordImpressionRef = useRef(recordImpression)
  recordImpressionRef.current = recordImpression
  const tracker = useCallback((): ImpressionDwellTracker => {
    trackerRef.current ??= createImpressionDwellTracker({
      onImpression: (itemId) => recordImpressionRef.current(itemId),
    })
    return trackerRef.current
  }, [])

  // True before the list has ever reported: the row mounts first, and
  // collapsing a terminal outcome on that silence is the jump R8 forbids. The
  // tracker's own row signal starts false, because evidence fails closed.
  const [shelfInView, setShelfInView] = useState(true)
  const reportShelfVisible = useCallback(
    (visible: boolean) => {
      setShelfInView(visible)
      tracker().setRowVisible(visible)
    },
    [tracker],
  )
  const reportVisibleCards = useCallback(
    (itemIds: readonly string[]) => tracker().setVisibleCards(itemIds),
    [tracker],
  )
  const reportShelfDetached = useCallback(
    () => tracker().detachRow(),
    [tracker],
  )

  useEffect(() => {
    const dwell = tracker()
    // Setup restores what the cleanup below suspends: dev StrictMode runs
    // setup → cleanup → setup on this same hook instance.
    dwell.setAppActive(isForegroundAppState(AppState.currentState))
    dwell.resume()
    const subscription = AppState.addEventListener("change", (next) => {
      dwell.setAppActive(isForegroundAppState(next))
    })
    return () => {
      subscription.remove()
      dwell.suspend()
    }
  }, [tracker])

  useEffect(() => {
    tracker().setFocused(focused)
  }, [focused, tracker])

  const trackedRequestId = enabled ? (displaySlate?.requestId ?? null) : null
  useEffect(() => {
    tracker().setRequestId(trackedRequestId)
  }, [trackedRequestId, tracker])

  return useMemo(
    () => ({
      status,
      slate: displaySlate,
      shelfInView,
      reportShelfMounted,
      reportShelfVisible,
      reportVisibleCards,
      reportShelfDetached,
      recordRender,
      recordImpression,
      select,
      refresh,
    }),
    [
      status,
      displaySlate,
      shelfInView,
      reportShelfMounted,
      reportShelfVisible,
      reportVisibleCards,
      reportShelfDetached,
      recordRender,
      recordImpression,
      select,
      refresh,
    ],
  )
}

export type { UserRecommendationItem }

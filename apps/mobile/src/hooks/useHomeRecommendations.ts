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
import { datadogLog } from "../lib/datadog"
import { resolveRecommendationContext } from "../lib/recommendations/context"
import type { UserRecommendationSlate } from "../lib/recommendations/delivery"
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
  select: (itemId: string) => Promise<SelectionResult | null>
  /** The single entry point for every event-driven refetch. */
  refresh: () => void
}

const NOOP = () => {}

/**
 * KTD5, KTD12: event-driven triggers inside this window collapse into one
 * refetch, so a return from a watch route plus a pull-to-refresh cannot spend
 * the viewer's whole evidence budget on duplicate slates.
 */
export const REFRESH_COALESCE_WINDOW_MS = 2_000

/** R8: the inner hook reached an outcome it will not retry, so the hold ends. */
function isTerminalNonServed(status: UserRecommendationsStatus): boolean {
  return (
    status === "unavailable" ||
    status === "disabled" ||
    status === "unprovisioned"
  )
}

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

  // One window for every trigger, so no entry point keeps its own.
  const lastRefetchAtRef = useRef(Number.NEGATIVE_INFINITY)
  const runAndSpendWindow = useCallback((run: () => void) => {
    lastRefetchAtRef.current = Date.now()
    run()
  }, [])

  /** KTD5: a trigger that lands inside another one's window is dropped. */
  const runCoalesced = useCallback(
    (run: () => void) => {
      const since = Date.now() - lastRefetchAtRef.current
      if (since < REFRESH_COALESCE_WINDOW_MS) return
      runAndSpendWindow(run)
    },
    [runAndSpendWindow],
  )

  // The held release and R16's expiry timer spend the window but are never
  // dropped by it: each one is the only trigger its own signal will produce.
  const refetchAlways = useCallback(
    () => runAndSpendWindow(() => innerRefreshRef.current()),
    [runAndSpendWindow],
  )

  const refresh = useCallback(
    () => runOrHold(() => runCoalesced(() => innerRefreshRef.current())),
    [runOrHold, runCoalesced],
  )

  const refreshOnExpiry = useCallback(
    () => runOrHold(refetchAlways),
    [runOrHold, refetchAlways],
  )

  // KTD6: the inner hook clears its slate at the start of every refetch, so
  // the last served one is held here and the shelf keeps its cards.
  const [displaySlate, setDisplaySlate] =
    useState<UserRecommendationSlate | null>(null)

  // A transition that lands while Home is blurred waits with every other
  // trigger. It spends the window but is never dropped by it: the clear below
  // empties the row, so a dropped refetch would leave nothing to show.
  const heldClient = useMemo<UserRecommendationsClient>(
    () => ({
      ...client,
      subscribeProfile: (listener) =>
        client.subscribeProfile?.(() => {
          // The identity moved, so the old viewer's capabilities must not back
          // another impression or selection while the refetch runs.
          setDisplaySlate(null)
          runOrHold(() => runAndSpendWindow(listener))
        }) ?? NOOP,
    }),
    [client, runOrHold, runAndSpendWindow],
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
    refetchAlways()
  }, [focused, latched, refetchAlways])

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
  const { status, recordRender, recordImpression, select } = recommendations

  // R18: the hold spans `loading` only. A terminal non-served outcome drops
  // the cards, because dead capabilities on screen keep sending evidence
  // Admin rejects. The row then shows its placeholder instead.
  const servedSlate = recommendations.slate
  useEffect(() => {
    if (!enabled) {
      setDisplaySlate(null)
      return
    }
    if (servedSlate != null) {
      setDisplaySlate(servedSlate)
      return
    }
    if (isTerminalNonServed(status)) setDisplaySlate(null)
  }, [enabled, servedSlate, status])

  // R16: past `expiresAt` the item capabilities are dead, so refresh rather
  // than let the shelf keep sending evidence Admin would reject.
  const expiresAt = displaySlate?.expiresAt ?? null
  useEffect(() => {
    if (!enabled || expiresAt == null) return
    const deadline = Date.parse(expiresAt)
    if (!Number.isFinite(deadline)) return
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      // An immediate refetch cannot rescue this: the next slate arrives
      // expired too. The coalesced triggers recover once the clock is right.
      datadogLog.warn("recommendation.slate_expired_on_arrival", {
        rec_surface: "home",
      })
      return
    }
    const timer = setTimeout(refreshOnExpiry, remaining)
    return () => clearTimeout(timer)
  }, [enabled, expiresAt, refreshOnExpiry])

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
      select,
      refresh,
    ],
  )
}

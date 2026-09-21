/**
 * Home's recommendations controller (feat-517 KTD3). Home hosts the slate hook
 * so the shelf stays a thin renderer: the shelf's first mount is the only fetch
 * trigger, a closed feed gate stops the slate, its expiry timer and its
 * evidence, and a blurred Home holds every refresh until focus returns.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useWatchPreferences } from "../contexts/WatchPreferencesProvider"
import { resolveRecommendationContext } from "../lib/recommendations/context"
import type {
  UserRecommendationSlate,
  UserRecommendationItem,
} from "../lib/recommendations/delivery"
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
  /** The shelf calls this on its first mount; that latch starts the fetch. */
  reportShelfMounted: () => void
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
  return useMemo(
    () => ({
      status,
      slate: displaySlate,
      reportShelfMounted,
      recordRender,
      recordImpression,
      select,
      refresh,
    }),
    [
      status,
      displaySlate,
      reportShelfMounted,
      recordRender,
      recordImpression,
      select,
      refresh,
    ],
  )
}

export type { UserRecommendationItem }

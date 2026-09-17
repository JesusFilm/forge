/**
 * The source-free slate for a UI surface (feat-516). Owns the retry loop
 * (one delayed retry per transient answer, three attempts), the evidence
 * ledger for the current slate, and the selection handoff. Capabilities stay
 * in memory on the returned items; nothing here is persisted.
 *
 * The client is injectable so the hook's decisions are unit-tested with no
 * Apollo, no viewer store and no timers beyond jest's fakes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  fetchUserRecommendations,
  getDeliveryDeps,
  isSlateExpired,
  type DeliveryResult,
  type UserRecommendationItem,
  type UserRecommendationSlate,
} from "../lib/recommendations/delivery"
import {
  createEvidenceLedger,
  getEvidenceDeps,
  recordEvidence,
  type EvidenceKind,
} from "../lib/recommendations/evidence"
import { USER_RECOMMENDATION_DEFAULT_COUNT } from "../lib/recommendations/operations"
import {
  getSelectionDeps,
  selectRecommendation,
  type SelectionResult,
} from "../lib/recommendations/selection"
import { getRecommendationViewerStore } from "../lib/recommendations/viewerIdentityClient"

/** Web's cadence: one delayed retry per transient answer, three tries. */
export const DELIVERY_RETRY_DELAY_MS = 5_000
export const DELIVERY_ATTEMPTS = 3

export type UserRecommendationsStatus =
  | "idle"
  | "loading"
  | "served"
  | "unavailable"
  | "disabled"
  | "unprovisioned"

export type UserRecommendationsClient = {
  fetch: (input: {
    locale: string
    audioLanguageSlug: string
    count: number
    attempt: number
  }) => Promise<DeliveryResult>
  recordEvidence: (
    kind: EvidenceKind,
    slate: UserRecommendationSlate,
    item: UserRecommendationItem,
    ledger: ReturnType<typeof createEvidenceLedger>,
  ) => Promise<unknown>
  select: (
    slate: UserRecommendationSlate,
    item: UserRecommendationItem,
  ) => Promise<SelectionResult>
  /** Fires after a profile transition (reset, withdraw, grant, delete) or a
   *  replaced identity: the displayed slate must refresh. */
  subscribeProfile?: (listener: () => void) => () => void
  now?: () => number
}

let defaultClient: UserRecommendationsClient | null = null

export function getUserRecommendationsClient(): UserRecommendationsClient {
  if (!defaultClient) {
    defaultClient = {
      fetch: (input) => fetchUserRecommendations(input, getDeliveryDeps()),
      recordEvidence: (kind, slate, item, ledger) =>
        recordEvidence(kind, slate, item, ledger, getEvidenceDeps()),
      select: (slate, item) =>
        selectRecommendation(slate, item, getSelectionDeps()),
      subscribeProfile: (listener) =>
        getRecommendationViewerStore().subscribe(listener),
    }
  }
  return defaultClient
}

export type UseUserRecommendationsOptions = {
  locale: string
  audioLanguageSlug: string
  count?: number
  /** False keeps the hook idle: no identity, no request. */
  enabled?: boolean
}

export type UseUserRecommendationsResult = {
  status: UserRecommendationsStatus
  /** Admin's reason when unavailable, else null. */
  reason: string | null
  items: UserRecommendationItem[]
  slate: UserRecommendationSlate | null
  refresh: () => void
  /** The item is on screen. Once per item per slate. */
  recordRender: (itemId: string) => void
  /** The UI qualified the item (50% visible for one continuous second). */
  recordImpression: (itemId: string) => void
  /** The viewer chose the item; resolves with the slug to open, or null. */
  select: (itemId: string) => Promise<SelectionResult | null>
}

export function useUserRecommendations(
  options: UseUserRecommendationsOptions,
  client: UserRecommendationsClient = getUserRecommendationsClient(),
): UseUserRecommendationsResult {
  const enabled = options.enabled ?? true
  const count = options.count ?? USER_RECOMMENDATION_DEFAULT_COUNT
  const [revision, setRevision] = useState(0)
  const key = `${options.locale}:${options.audioLanguageSlug}:${count}:${revision}`
  const [state, setState] = useState<{
    key: string
    status: UserRecommendationsStatus
    reason: string | null
    slate: UserRecommendationSlate | null
  }>({ key, status: "idle", reason: null, slate: null })
  const current =
    state.key === key
      ? state
      : { key, status: "idle" as const, reason: null, slate: null }
  const ledgerRef = useRef(createEvidenceLedger())
  const selectingRef = useRef(false)
  const clientRef = useRef(client)
  clientRef.current = client

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    ledgerRef.current = createEvidenceLedger()
    // `selectingRef` is NOT reset here: a refresh that lands mid-selection
    // must not let a second select() start; select()'s own finally clears it.
    setState({ key, status: "loading", reason: null, slate: null })
    const load = async (attempt: number) => {
      let result: DeliveryResult
      try {
        result = await clientRef.current.fetch({
          locale: options.locale,
          audioLanguageSlug: options.audioLanguageSlug,
          count,
          attempt,
        })
      } catch {
        result = {
          kind: "unavailable",
          reason: "client_error",
          retryable: false,
        }
      }
      if (cancelled) return
      if (result.kind === "served") {
        setState({ key, status: "served", reason: null, slate: result.slate })
        return
      }
      if (result.kind === "disabled" || result.kind === "unprovisioned") {
        setState({ key, status: result.kind, reason: null, slate: null })
        return
      }
      if (result.retryable && attempt < DELIVERY_ATTEMPTS) {
        timer = setTimeout(() => {
          void load(attempt + 1)
        }, DELIVERY_RETRY_DELAY_MS)
        return
      }
      setState({
        key,
        status: "unavailable",
        reason: result.reason,
        slate: null,
      })
    }
    void load(1)
    return () => {
      cancelled = true
      if (timer != null) clearTimeout(timer)
    }
  }, [enabled, key, options.locale, options.audioLanguageSlug, count])

  const refresh = useCallback(() => setRevision((value) => value + 1), [])

  // A profile transition (reset, withdraw, grant, delete) or a replaced
  // identity invalidates the slate on screen; the contract says refresh it.
  useEffect(() => {
    return clientRef.current.subscribeProfile?.(refresh)
  }, [refresh])

  // A caller that switches the surface off gets no items either: a shelf keyed
  // on `items.length` would otherwise keep rendering and sending evidence.
  const slate = enabled ? current.slate : null
  // The response's `expiresAt` is the authority on the item capabilities;
  // evidence or a selection past it would only be rejected.
  const expired = useCallback(
    () =>
      slate != null &&
      isSlateExpired(slate, (clientRef.current.now ?? Date.now)()),
    [slate],
  )
  const evidence = useCallback(
    (kind: EvidenceKind, itemId: string) => {
      if (!slate || expired()) return
      const item = slate.items.find((entry) => entry.id === itemId)
      if (!item) return
      void clientRef.current
        .recordEvidence(kind, slate, item, ledgerRef.current)
        .catch(() => undefined)
    },
    [slate, expired],
  )

  const recordRender = useCallback(
    (itemId: string) => evidence("render", itemId),
    [evidence],
  )
  const recordImpression = useCallback(
    (itemId: string) => evidence("impression", itemId),
    [evidence],
  )

  const select = useCallback(
    async (itemId: string): Promise<SelectionResult | null> => {
      if (!slate || selectingRef.current || expired()) return null
      const item = slate.items.find((entry) => entry.id === itemId)
      if (!item) return null
      selectingRef.current = true
      try {
        return await clientRef.current.select(slate, item)
      } catch {
        return null
      } finally {
        selectingRef.current = false
      }
    },
    [slate, expired],
  )

  return useMemo(
    () => ({
      status: enabled ? current.status : "idle",
      reason: enabled ? current.reason : null,
      items: slate?.items ?? [],
      slate,
      refresh,
      recordRender,
      recordImpression,
      select,
    }),
    [
      enabled,
      current.status,
      current.reason,
      slate,
      refresh,
      recordRender,
      recordImpression,
      select,
    ],
  )
}

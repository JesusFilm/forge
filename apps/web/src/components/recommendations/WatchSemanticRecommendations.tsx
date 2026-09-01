"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { MouseEvent } from "react"
import type { Route } from "next"
import { VideoRecommendations } from "@/components/sections/VideoRecommendations"
import { RecommendationPersonalizationControl } from "@/components/recommendations/RecommendationPersonalizationControl"
import { useEligibleRecommendationImpression } from "@/components/recommendations/useEligibleRecommendationImpression"
import {
  randomRecommendationNonce,
  recommendationEventId,
  recommendationFetchWithRetry,
  recommendationJsonWithDeadline,
  withinRecommendationDeadline,
} from "@/lib/recommendation-browser"
import {
  waitForRecommendationConsentBootstrap,
  withRecommendationConsentLock,
} from "@/lib/recommendation-consent-bootstrap"
import type { SceneRecommendation } from "@/lib/recommendations"
import {
  CONTEXTUAL_RECOMMENDATION_FALLBACK_CAPABILITY,
  RECOMMENDATION_EVIDENCE_CONTRACT,
  RECOMMENDATION_TAB_CORRELATION_KEY,
  SEMANTIC_RECOMMENDATION_CONTRACT,
  WATCH_RECOMMENDATION_SURFACE,
} from "@/lib/recommendation-contracts"
import {
  isCanonicalWatchRecommendationHref,
  WATCH_BASE_PATH,
} from "@/lib/routes"
import { RecommendationRuntimeError } from "@/lib/recommendation-errors"
import { watchPath } from "@/lib/watch-paths"

const DELIVERY_ENDPOINT = watchPath("/api/recommendations")
const EVIDENCE_ENDPOINT = watchPath("/api/recommendations/evidence")
const SELECTION_ENDPOINT = watchPath("/api/recommendations/select")
const DELIVERY_DEADLINE_MS = 12_000
const DELIVERY_RETRY_MS = 500
const DELIVERY_MAX_ATTEMPTS = 3
// Recommendation delivery admission v1 uses this exact same-session/seed
// cooldown and currently exposes it through the versioned response reason.
const DELIVERY_COOLDOWN_MS = 5_000
const SELECTION_DEADLINE_MS = 800
const EVIDENCE_DEADLINE_MS = 1_000

async function recommendationDeliveryJsonWithDeadline(
  init: RequestInit,
  deadlineMs: number,
): Promise<unknown> {
  return withinRecommendationDeadline(
    init.signal,
    deadlineMs,
    async (signal) => {
      const response = await fetch(DELIVERY_ENDPOINT, { ...init, signal })
      if (!response.ok) {
        throw new RecommendationRuntimeError(
          response.status >= 500 ? "delivery_unavailable" : "request_failed",
        )
      }
      try {
        return await response.json()
      } catch {
        throw new RecommendationRuntimeError("request_failed")
      }
    },
  )
}

type SemanticRecommendationItem = SceneRecommendation & {
  id: string
  position: number
  targetMediaId: string
  canonicalHref: string
  candidateGenerator: "semantic" | "multi-interest-profile"
  contributors: Array<{
    generator: string
    generatorVersion: string
    rank: number
  }>
  capability: string
}

type SemanticEnvelope = {
  contractVersion: typeof SEMANTIC_RECOMMENDATION_CONTRACT
  surfaceVersion: typeof WATCH_RECOMMENDATION_SURFACE
  strategyVersion: string
  classifierVersion: string
  requestId: string | null
  result: "served" | "fallback" | "empty" | "unavailable"
  reason: string | null
  expiresAt: string | null
  requestedCount: number | null
  composedCount: number | null
  shortfallReason:
    | "insufficient_candidates"
    | "seed_material_unavailable"
    | "eligibility_exhausted"
    | "deadline_exhausted"
    | null
  items: SemanticRecommendationItem[]
  personalization: {
    contractVersion: "anonymous-profile-personalization-v1"
    lane: "semantic_control" | "profile_challenger" | "semantic_fallback"
    executionMode:
      | "semantic_contextual"
      | "hybrid_personalized"
      | "semantic_fallback"
      | null
    effectiveManifestId: string
    profileState: "session" | "durable" | null
    projectionVersion: string | null
    projectionGeneration: number | null
    interestCount: number
    sessionIntentPresent: boolean
    reason: string | null
  } | null
}

type RecommendationState =
  | { requestKey: string; status: "loading" }
  | { requestKey: string; status: "ready"; envelope: SemanticEnvelope }
  | { requestKey: string; status: "empty" }
  | { requestKey: string; status: "unavailable" }

const NO_RECOMMENDATION_ITEMS: SemanticRecommendationItem[] = []

type SelectionAttempt = {
  id: number
  itemId: string
  controller: AbortController
}

function nonEmptyString(value: unknown, max = 4096): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max
}

function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  )
}

function parseContributors(
  value: unknown,
): SemanticRecommendationItem["contributors"] | null {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > 16) return null
  const contributors: SemanticRecommendationItem["contributors"] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null
    const contributor = entry as Record<string, unknown>
    if (
      !nonEmptyString(contributor.generator, 64) ||
      !nonEmptyString(contributor.generatorVersion, 64) ||
      !Number.isInteger(contributor.rank) ||
      Number(contributor.rank) < 1 ||
      Number(contributor.rank) > 64
    ) {
      return null
    }
    const key = `${contributor.generator}\0${contributor.generatorVersion}`
    if (seen.has(key)) return null
    seen.add(key)
    contributors.push({
      generator: contributor.generator,
      generatorVersion: contributor.generatorVersion,
      rank: contributor.rank as number,
    })
  }
  return contributors
}

function parseItem(value: unknown): SemanticRecommendationItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  if (
    !nonEmptyString(item.id, 191) ||
    typeof item.position !== "number" ||
    !Number.isInteger(item.position) ||
    item.position < 0 ||
    item.position > 5 ||
    !nonEmptyString(item.targetMediaId, 191) ||
    !isCanonicalWatchRecommendationHref(item.canonicalHref) ||
    (item.candidateGenerator !== "semantic" &&
      item.candidateGenerator !== "multi-interest-profile") ||
    !nonEmptyString(item.capability) ||
    !nonEmptyString(item.videoSlug, 191) ||
    !nonEmptyString(item.videoTitle, 512) ||
    !(item.imageUrl == null || typeof item.imageUrl === "string") ||
    typeof item.sceneIndex !== "number" ||
    !Number.isInteger(item.sceneIndex) ||
    typeof item.description !== "string" ||
    typeof item.startSeconds !== "number" ||
    !(item.endSeconds == null || typeof item.endSeconds === "number") ||
    !(
      item.durationSeconds == null ||
      (typeof item.durationSeconds === "number" &&
        Number.isFinite(item.durationSeconds) &&
        item.durationSeconds >= 0 &&
        item.durationSeconds <= 86_400)
    ) ||
    typeof item.similarity !== "number" ||
    !stringArray(item.themes) ||
    !stringArray(item.demographics) ||
    !stringArray(item.spiritualContext) ||
    !nonEmptyString(item.playbackId, 512)
  ) {
    return null
  }
  const contributors = parseContributors(item.contributors)
  if (!contributors) return null
  return {
    id: item.id,
    position: item.position,
    targetMediaId: item.targetMediaId,
    canonicalHref: item.canonicalHref,
    candidateGenerator: item.candidateGenerator,
    contributors,
    capability: item.capability,
    videoId: item.targetMediaId,
    videoSlug: item.videoSlug,
    videoTitle: item.videoTitle,
    imageUrl: item.imageUrl ?? null,
    sceneIndex: item.sceneIndex,
    description: item.description,
    startSeconds: item.startSeconds,
    endSeconds: item.endSeconds ?? null,
    durationSeconds: item.durationSeconds ?? null,
    similarity: item.similarity,
    themes: item.themes,
    demographics: item.demographics,
    spiritualContext: item.spiritualContext,
    playbackId: item.playbackId,
  }
}

function parseEnvelope(value: unknown): SemanticEnvelope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const envelope = value as Record<string, unknown>
  const result = envelope.result
  const countFields = [envelope.requestedCount, envelope.composedCount].filter(
    (entry) => entry != null,
  )
  const shortfallReasons = new Set([
    "insufficient_candidates",
    "seed_material_unavailable",
    "eligibility_exhausted",
    "deadline_exhausted",
  ])
  if (
    envelope.contractVersion !== SEMANTIC_RECOMMENDATION_CONTRACT ||
    envelope.surfaceVersion !== WATCH_RECOMMENDATION_SURFACE ||
    !nonEmptyString(envelope.strategyVersion, 191) ||
    !nonEmptyString(envelope.classifierVersion, 191) ||
    !(envelope.requestId == null || nonEmptyString(envelope.requestId, 191)) ||
    !(
      result === "served" ||
      result === "fallback" ||
      result === "empty" ||
      result === "unavailable"
    ) ||
    !(envelope.reason == null || typeof envelope.reason === "string") ||
    !(envelope.expiresAt == null || typeof envelope.expiresAt === "string") ||
    !Array.isArray(envelope.items) ||
    envelope.items.length > 6 ||
    (countFields.length !== 0 && countFields.length !== 2) ||
    (envelope.requestedCount != null &&
      (!Number.isInteger(envelope.requestedCount) ||
        Number(envelope.requestedCount) < 0 ||
        Number(envelope.requestedCount) > 6)) ||
    (envelope.composedCount != null &&
      (!Number.isInteger(envelope.composedCount) ||
        Number(envelope.composedCount) < 0 ||
        Number(envelope.composedCount) > 6)) ||
    (envelope.shortfallReason != null &&
      (typeof envelope.shortfallReason !== "string" ||
        !shortfallReasons.has(envelope.shortfallReason)))
  ) {
    return null
  }
  const items = envelope.items.map(parseItem)
  if (items.some((item) => item == null)) return null
  const parsedItems = items as SemanticRecommendationItem[]
  if (
    new Set(parsedItems.map((item) => item.id)).size !== parsedItems.length ||
    new Set(parsedItems.map((item) => item.position)).size !==
      parsedItems.length ||
    new Set(parsedItems.map((item) => item.targetMediaId)).size !==
      parsedItems.length ||
    new Set(parsedItems.map((item) => item.canonicalHref)).size !==
      parsedItems.length
  ) {
    return null
  }
  if (
    envelope.requestedCount != null &&
    envelope.composedCount != null &&
    (Number(envelope.composedCount) > Number(envelope.requestedCount) ||
      Number(envelope.composedCount) !== parsedItems.length ||
      (Number(envelope.composedCount) < Number(envelope.requestedCount)
        ? envelope.shortfallReason == null
        : envelope.shortfallReason != null))
  ) {
    return null
  }
  const isUnattributedContextualFallback =
    result === "fallback" &&
    envelope.requestId == null &&
    parsedItems.length > 0 &&
    parsedItems.every(
      (item) =>
        item.capability === CONTEXTUAL_RECOMMENDATION_FALLBACK_CAPABILITY,
    )
  if (
    (result === "served" && !envelope.requestId) ||
    (result === "fallback" &&
      !envelope.requestId &&
      !isUnattributedContextualFallback)
  ) {
    return null
  }
  const personalization = parsePersonalization(envelope.personalization)
  if (envelope.personalization != null && !personalization) return null
  return {
    contractVersion: SEMANTIC_RECOMMENDATION_CONTRACT,
    surfaceVersion: WATCH_RECOMMENDATION_SURFACE,
    strategyVersion: envelope.strategyVersion,
    classifierVersion: envelope.classifierVersion,
    requestId: envelope.requestId ?? null,
    result,
    reason: envelope.reason ?? null,
    expiresAt: envelope.expiresAt ?? null,
    requestedCount:
      (envelope.requestedCount as number | null | undefined) ?? null,
    composedCount:
      (envelope.composedCount as number | null | undefined) ?? null,
    shortfallReason:
      (envelope.shortfallReason as
        | SemanticEnvelope["shortfallReason"]
        | undefined) ?? null,
    items: parsedItems,
    personalization,
  }
}

function parsePersonalization(
  value: unknown,
): SemanticEnvelope["personalization"] {
  if (value == null) return null
  if (typeof value !== "object" || Array.isArray(value)) return null
  const profile = value as Record<string, unknown>
  if (
    profile.contractVersion !== "anonymous-profile-personalization-v1" ||
    (profile.lane !== "semantic_control" &&
      profile.lane !== "profile_challenger" &&
      profile.lane !== "semantic_fallback") ||
    (profile.executionMode != null &&
      profile.executionMode !== "semantic_contextual" &&
      profile.executionMode !== "hybrid_personalized" &&
      profile.executionMode !== "semantic_fallback") ||
    !nonEmptyString(profile.effectiveManifestId, 191) ||
    (profile.profileState != null &&
      profile.profileState !== "session" &&
      profile.profileState !== "durable") ||
    (profile.projectionVersion != null &&
      typeof profile.projectionVersion !== "string") ||
    (profile.projectionGeneration != null &&
      (!Number.isInteger(profile.projectionGeneration) ||
        Number(profile.projectionGeneration) < 1)) ||
    !Number.isInteger(profile.interestCount) ||
    Number(profile.interestCount) < 0 ||
    Number(profile.interestCount) > 5 ||
    typeof profile.sessionIntentPresent !== "boolean" ||
    (profile.reason != null && typeof profile.reason !== "string")
  ) {
    return null
  }
  if (
    profile.executionMode != null &&
    !(
      (profile.lane === "semantic_control" &&
        profile.executionMode === "semantic_contextual") ||
      (profile.lane === "profile_challenger" &&
        profile.executionMode === "hybrid_personalized") ||
      (profile.lane === "semantic_fallback" &&
        profile.executionMode === "semantic_fallback")
    )
  ) {
    return null
  }
  return {
    contractVersion: "anonymous-profile-personalization-v1",
    lane: profile.lane,
    executionMode: profile.executionMode ?? null,
    effectiveManifestId: profile.effectiveManifestId,
    profileState: profile.profileState ?? null,
    projectionVersion: profile.projectionVersion ?? null,
    projectionGeneration:
      (profile.projectionGeneration as number | null | undefined) ?? null,
    interestCount: profile.interestCount as number,
    sessionIntentPresent: profile.sessionIntentPresent,
    reason: profile.reason ?? null,
  }
}

function tabNonce() {
  let existing: string | null = null
  try {
    existing = sessionStorage.getItem(RECOMMENDATION_TAB_CORRELATION_KEY)
  } catch {
    // Storage can be disabled by browser privacy policy. Attribution remains
    // best effort and must never block navigation.
  }
  if (existing) return existing
  const created = randomRecommendationNonce()
  try {
    sessionStorage.setItem(RECOMMENDATION_TAB_CORRELATION_KEY, created)
  } catch {
    // The nonce still authorizes this selection request in memory. A target
    // claim may be unavailable, but the trusted href remains usable.
  }
  return created
}

function storeClaimNonce(value: string) {
  try {
    sessionStorage.setItem(RECOMMENDATION_TAB_CORRELATION_KEY, value)
  } catch {
    // Fail open to the token-free stored target when tab storage is disabled.
  }
}

function eventId(kind: string, itemId: string) {
  return recommendationEventId(kind, itemId)
}

function defaultNavigate(href: string) {
  window.location.assign(href)
}

function recommendationHref(item: SemanticRecommendationItem): Route {
  // Next Link applies the configured basePath. Admin persists the complete
  // canonical Watch path, so pass Link only the portion beneath that base to
  // avoid rendering `/watch/watch/...` while selection still navigates with
  // the stored canonical target.
  return item.canonicalHref.slice(WATCH_BASE_PATH.length) as Route
}

function recommendationKey(item: SemanticRecommendationItem): string {
  return item.id
}

export function WatchSemanticRecommendations({
  seedMediaId,
  seedMediaSlug,
  locale,
  audioLanguageSlug,
  navigate = defaultNavigate,
}: {
  seedMediaId: string
  seedMediaSlug?: string
  locale: string
  audioLanguageSlug: string
  navigate?: (href: string) => void
}) {
  const [profileRevision, setProfileRevision] = useState(0)
  const requestKey = `${seedMediaId}\0${seedMediaSlug ?? ""}\0${locale}\0${audioLanguageSlug}\0${profileRevision}`
  const [state, setState] = useState<RecommendationState>({
    requestKey,
    status: "loading",
  })
  const [instrumentationState, setInstrumentationState] = useState({
    requestKey,
    degraded: false,
  })
  const [busyState, setBusyState] = useState<{
    requestKey: string
    itemId: string | null
  }>({ requestKey, itemId: null })
  const mountedRef = useRef(false)
  const selectionGenerationRef = useRef(0)
  const selectionAttemptRef = useRef<SelectionAttempt | null>(null)
  const navigationStartedRef = useRef(false)
  const evidenceLedger = useRef({
    requestId: null as string | null,
    rendered: new Set<string>(),
    impressed: new Set<string>(),
  })

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      selectionGenerationRef.current += 1
      selectionAttemptRef.current?.controller.abort()
      selectionAttemptRef.current = null
    }
  }, [])

  useEffect(() => {
    const refresh = () => {
      if (selectionAttemptRef.current || navigationStartedRef.current) return
      setProfileRevision((revision) => revision + 1)
    }
    window.addEventListener("forge:recommendation-profile-changed", refresh)
    return () =>
      window.removeEventListener(
        "forge:recommendation-profile-changed",
        refresh,
      )
  }, [])

  useEffect(() => {
    let active = true
    let controller: AbortController | null = null
    let deliveryRetryTimer: number | null = null
    let deliveryDeadlineAt: number | null = null
    selectionGenerationRef.current += 1
    selectionAttemptRef.current?.controller.abort()
    selectionAttemptRef.current = null
    navigationStartedRef.current = false
    evidenceLedger.current.requestId = null
    evidenceLedger.current.rendered.clear()
    evidenceLedger.current.impressed.clear()
    // StrictMode replays setup/cleanup before the microtask queue drains. The
    // first setup therefore cancels without issuing a state-creating POST.
    queueMicrotask(() => {
      if (!active) return
      setState({ requestKey, status: "loading" })
      const scheduleRetry = (attempt: number, delayMs: number) => {
        if (
          !active ||
          attempt + 1 >= DELIVERY_MAX_ATTEMPTS ||
          (deliveryDeadlineAt != null &&
            Date.now() + delayMs >= deliveryDeadlineAt)
        ) {
          return false
        }
        deliveryRetryTimer = window.setTimeout(() => {
          deliveryRetryTimer = null
          load(attempt + 1)
        }, delayMs)
        return true
      }
      const load = (attempt: number) => {
        if (!active) return
        if (
          deliveryDeadlineAt != null &&
          deliveryDeadlineAt - Date.now() <= 0
        ) {
          setState({ requestKey, status: "unavailable" })
          return
        }
        const attemptController = new AbortController()
        controller = attemptController
        void waitForRecommendationConsentBootstrap()
          .then(() =>
            withRecommendationConsentLock(async () => {
              if (!active || attemptController.signal.aborted) {
                throw new RecommendationRuntimeError("deadline")
              }
              deliveryDeadlineAt ??= Date.now() + DELIVERY_DEADLINE_MS
              const attemptRemainingMs = deliveryDeadlineAt - Date.now()
              if (attemptRemainingMs <= 0) {
                throw new RecommendationRuntimeError("deadline")
              }
              return recommendationDeliveryJsonWithDeadline(
                {
                  method: "POST",
                  cache: "no-store",
                  credentials: "same-origin",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    seedMediaId,
                    ...(seedMediaSlug ? { seedMediaSlug } : {}),
                    locale,
                    audioLanguageSlug,
                  }),
                  signal: attemptController.signal,
                },
                attemptRemainingMs,
              )
            }),
          )
          .then((value) => {
            if (!active || !value || typeof value !== "object") return
            const envelope = parseEnvelope(
              (value as { delivery?: unknown }).delivery,
            )
            if (!envelope) {
              setState({ requestKey, status: "unavailable" })
              return
            }
            if (
              (envelope.result === "served" ||
                envelope.result === "fallback") &&
              envelope.items.length > 0
            ) {
              setState({ requestKey, status: "ready", envelope })
            } else if (envelope.result === "empty") {
              setState({ requestKey, status: "empty" })
            } else if (
              envelope.result === "unavailable" &&
              attempt + 1 < DELIVERY_MAX_ATTEMPTS &&
              (envelope.reason === "cooldown" ||
                envelope.reason === "in_flight" ||
                envelope.reason === "delivery_unavailable" ||
                envelope.reason === "delivery_timeout")
            ) {
              const retryMs =
                envelope.reason === "cooldown" ||
                envelope.reason === "in_flight"
                  ? DELIVERY_COOLDOWN_MS
                  : DELIVERY_RETRY_MS
              if (!scheduleRetry(attempt, retryMs)) {
                setState({ requestKey, status: "unavailable" })
              }
            } else {
              setState({ requestKey, status: "unavailable" })
            }
          })
          .catch((error) => {
            if (!active) return
            const transientFailure =
              !(error instanceof RecommendationRuntimeError) ||
              error.code === "delivery_unavailable"
            if (transientFailure && scheduleRetry(attempt, DELIVERY_RETRY_MS)) {
              return
            }
            setState({ requestKey, status: "unavailable" })
          })
      }
      load(0)
    })
    return () => {
      active = false
      if (deliveryRetryTimer != null) {
        window.clearTimeout(deliveryRetryTimer)
      }
      controller?.abort()
    }
  }, [audioLanguageSlug, locale, requestKey, seedMediaId, seedMediaSlug])

  const currentState = useMemo<RecommendationState>(
    () =>
      state.requestKey === requestKey
        ? state
        : { requestKey, status: "loading" },
    [requestKey, state],
  )

  const items = useMemo(
    () =>
      currentState.status === "ready"
        ? currentState.envelope.items
        : NO_RECOMMENDATION_ITEMS,
    [currentState],
  )
  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  )
  const requestId =
    currentState.status === "ready" ? currentState.envelope.requestId : null

  const claimEvidence = useCallback(
    (kind: "render" | "impression", itemId: string) => {
      const ledger = evidenceLedger.current
      if (ledger.requestId !== requestId) {
        ledger.requestId = requestId
        ledger.rendered.clear()
        ledger.impressed.clear()
      }
      const facts = kind === "render" ? ledger.rendered : ledger.impressed
      if (facts.has(itemId)) return false
      facts.add(itemId)
      return true
    },
    [requestId],
  )

  const sendEvidence = useCallback(
    async (item: SemanticRecommendationItem, kind: "render" | "impression") => {
      if (
        !requestId ||
        item.capability === CONTEXTUAL_RECOMMENDATION_FALLBACK_CAPABILITY
      ) {
        return
      }
      await recommendationFetchWithRetry(
        EVIDENCE_ENDPOINT,
        {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          keepalive: true,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contractVersion: RECOMMENDATION_EVIDENCE_CONTRACT,
            requestId,
            itemId: item.id,
            capability: item.capability,
            events: [
              {
                eventId: eventId(kind, item.id),
                kind,
                occurredAt: new Date().toISOString(),
                payload:
                  kind === "impression"
                    ? { visibilityPolicy: WATCH_RECOMMENDATION_SURFACE }
                    : { surfacePolicy: WATCH_RECOMMENDATION_SURFACE },
              },
            ],
          }),
        },
        EVIDENCE_DEADLINE_MS,
      )
    },
    [requestId],
  )

  const markInstrumentationDegraded = useCallback(() => {
    setInstrumentationState((current) =>
      current.requestKey === requestKey && current.degraded
        ? current
        : { requestKey, degraded: true },
    )
  }, [requestKey])

  useEffect(() => {
    for (const item of items) {
      if (claimEvidence("render", item.id)) {
        void sendEvidence(item, "render").catch(markInstrumentationDegraded)
      }
    }
  }, [claimEvidence, items, markInstrumentationDegraded, sendEvidence])

  const onEligible = useCallback(
    (itemId: string) => {
      const item = itemById.get(itemId)
      if (item && claimEvidence("impression", item.id)) {
        void sendEvidence(item, "impression").catch(markInstrumentationDegraded)
      }
    },
    [claimEvidence, itemById, markInstrumentationDegraded, sendEvidence],
  )
  const onCardElement = useEligibleRecommendationImpression({
    envelopeKey: requestId ?? "none",
    onEligible,
  })
  const onRecommendationCardElement = useCallback(
    (item: SemanticRecommendationItem, element: HTMLAnchorElement | null) =>
      onCardElement(item.id, element),
    [onCardElement],
  )

  const navigateOnce = useCallback(
    (href: string) => {
      if (navigationStartedRef.current) return
      navigationStartedRef.current = true
      navigate(href)
    },
    [navigate],
  )

  const onSelect = useCallback(
    (
      item: SemanticRecommendationItem,
      event: MouseEvent<HTMLAnchorElement>,
    ) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return
      }
      event.preventDefault()
      if (selectionAttemptRef.current || navigationStartedRef.current) return
      if (item.capability === CONTEXTUAL_RECOMMENDATION_FALLBACK_CAPABILITY) {
        navigateOnce(item.canonicalHref)
        return
      }
      const controller = new AbortController()
      const attemptId = selectionGenerationRef.current + 1
      selectionGenerationRef.current = attemptId
      selectionAttemptRef.current = {
        id: attemptId,
        itemId: item.id,
        controller,
      }
      setBusyState({ requestKey, itemId: item.id })
      const correlation = tabNonce()
      const isCurrentAttempt = () =>
        mountedRef.current &&
        selectionGenerationRef.current === attemptId &&
        selectionAttemptRef.current?.id === attemptId
      void recommendationJsonWithDeadline(
        SELECTION_ENDPOINT,
        {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            contractVersion: RECOMMENDATION_EVIDENCE_CONTRACT,
            requestId,
            itemId: item.id,
            capability: item.capability,
            eventId: eventId("selection", item.id),
            occurredAt: new Date().toISOString(),
            tabNonce: correlation,
          }),
        },
        SELECTION_DEADLINE_MS,
      )
        .then((value) => {
          if (!isCurrentAttempt()) return
          const handoff = value as Record<string, unknown>
          if (
            nonEmptyString(handoff.claimNonce, 191) &&
            handoff.claimNonce.length >= 16 &&
            handoff.canonicalHref === item.canonicalHref &&
            handoff.targetMediaId === item.targetMediaId
          ) {
            storeClaimNonce(handoff.claimNonce)
            navigateOnce(item.canonicalHref)
            return
          }
          navigateOnce(item.canonicalHref)
        })
        .catch(() => {
          if (isCurrentAttempt()) navigateOnce(item.canonicalHref)
        })
    },
    [navigateOnce, requestId, requestKey],
  )

  const busyItemId =
    busyState.requestKey === requestKey ? busyState.itemId : null
  const instrumentationDegraded =
    instrumentationState.requestKey === requestKey &&
    instrumentationState.degraded
  const recommendationExplanation =
    currentState.status === "ready"
      ? viewerRecommendationExplanation(currentState.envelope)
      : null

  if (currentState.status === "loading") {
    return (
      <section
        data-block-type="SemanticRecommendations"
        data-state="loading"
        aria-busy="true"
        aria-label="Loading recommended videos"
        className="min-h-48 rounded-xl bg-stone-800/40 p-6"
      />
    )
  }
  if (
    currentState.status === "empty" ||
    currentState.status === "unavailable"
  ) {
    return null
  }

  let announcement = ""
  if (busyItemId) {
    announcement = `Opening ${itemById.get(busyItemId)?.videoTitle ?? "video"}`
  } else if (instrumentationDegraded) {
    announcement =
      "Recommendation activity could not be recorded. Links still work."
  } else if (currentState.envelope.result === "fallback") {
    announcement = currentState.envelope.items.every(
      (item) =>
        item.capability === CONTEXTUAL_RECOMMENDATION_FALLBACK_CAPABILITY,
    )
      ? "Showing contextual recommendations."
      : "Showing saved recommendations."
  }

  return (
    <section
      data-block-type="SemanticRecommendations"
      data-state={
        currentState.envelope.result === "fallback" ? "fallback" : "ready"
      }
      aria-label="Recommended videos"
      className="min-h-48"
    >
      <h2 className="mb-4 text-2xl font-semibold text-white">
        Recommended videos
      </h2>
      <VideoRecommendations
        recommendations={currentState.envelope.items}
        locale={locale}
        hrefBuilder={recommendationHref}
        recommendationKey={recommendationKey}
        onRecommendationSelect={onSelect}
        onRecommendationCardElement={onRecommendationCardElement}
        busyRecommendationKey={busyItemId}
        showRankingMetadata={false}
        recommendationTimeMode="video-duration"
      />
      {recommendationExplanation ? (
        <p className="mt-3 text-xs text-stone-400" aria-live="polite">
          {recommendationExplanation}
        </p>
      ) : null}
      <RecommendationPersonalizationControl />
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </section>
  )
}

function viewerRecommendationExplanation(envelope: SemanticEnvelope) {
  const mode = envelope.personalization?.executionMode
  if (mode === "hybrid_personalized") {
    return "Recommended from this video and interests you chose to remember."
  }
  if (mode === "semantic_contextual") {
    return "Recommended from what you're watching now."
  }
  if (mode === "semantic_fallback") {
    return "Recommended from what you're watching now while personalization is unavailable."
  }
  // Historic deliveries predate the additive execution-mode field. Preserve
  // their existing viewer explanation without reinterpreting lane semantics.
  if (envelope.personalization?.lane === "profile_challenger") {
    return envelope.personalization.profileState === "durable"
      ? "Personalized from interests you chose to remember."
      : "Personalized for this visit."
  }
  return null
}

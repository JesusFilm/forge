"use client"

import { useCallback, useEffect, useRef } from "react"
import type { MuxPlayerRef } from "@forge/video-player"

import {
  RECOMMENDATION_EVIDENCE_CONTRACT,
  RECOMMENDATION_PLAYBACK_BODY_BYTES,
  RECOMMENDATION_PLAYBACK_EVENT_LIMIT,
  RECOMMENDATION_TAB_CORRELATION_KEY,
  parseRecommendationEpisodeCapability,
  parseRecommendationPlaybackReceipts,
  type RecommendationEpisodeCapability,
  type RecommendationPlaybackEvent,
} from "@/lib/recommendation-contracts"
import {
  recommendationEventId,
  withinRecommendationDeadline,
} from "@/lib/recommendation-browser"
import { RecommendationRuntimeError } from "@/lib/recommendation-errors"
import {
  waitForRecommendationConsentBootstrap,
  withRecommendationConsentLock,
} from "@/lib/recommendation-consent-bootstrap"
import { consumePlaybackDiscoveryContext } from "@/lib/playback-discovery"
import { RECOMMENDATION_EVIDENCE_BROWSER_DEADLINE_MS } from "@/lib/recommendation-timeouts"
import { watchPath } from "@/lib/watch-paths"
import { createViewingModeRecorder } from "@/lib/viewing-mode-recorder"

const PLAYBACK_ENDPOINT = watchPath("/api/recommendations/playback")
const REQUEST_DEADLINE_MS = RECOMMENDATION_EVIDENCE_BROWSER_DEADLINE_MS
const MAX_CLAIM_ATTEMPTS = 3
const CLAIM_RETRY_BACKOFF_MS = 250
const MAX_EPISODE_FACTS = 128
const MAX_PENDING_CLAIM_FACTS = 16
const MAX_PENDING_REGULAR_FACTS = MAX_PENDING_CLAIM_FACTS - 1
const MAX_FACT_DELIVERY_ATTEMPTS = 3
const FACT_RETRY_BACKOFF_MS = 100
const PROGRESS_INTERVAL_MS = 10_000
const MAX_ACTIVE_CHUNK_MS = 60_000
const UTF8_ENCODER = new TextEncoder()

const MAX_FACTS_BY_KIND: Readonly<
  Record<RecommendationPlaybackEvent["kind"], number>
> = {
  playback_attempt: 1,
  playback_start: 1,
  playback_progress: 64,
  playback_seek: 32,
  playback_observation: 1,
  playback_navigation: 16,
  playback_qoe: 16,
  playback_viewing_mode: 32,
  playback_active_visible_playing: 64,
  playback_end: 1,
  playback_error: 1,
}

function isObservationEvent(fact: RecommendationPlaybackEvent): boolean {
  return [
    "playback_observation",
    "playback_navigation",
    "playback_qoe",
    "playback_viewing_mode",
  ].includes(fact.kind)
}

type EndReason = Extract<
  RecommendationPlaybackEvent,
  { kind: "playback_end" }
>["payload"]["reason"]

function randomEventId(kind: RecommendationPlaybackEvent["kind"]): string {
  return recommendationEventId(kind)
}

function event<T extends RecommendationPlaybackEvent>(
  value: Omit<T, "eventId" | "occurredAt">,
  occurredAt = new Date(),
): T {
  return {
    ...value,
    eventId: randomEventId(value.kind),
    occurredAt: occurredAt.toISOString(),
  } as T
}

function boundedPosition(player: MuxPlayerRef): number {
  const value = player.currentTime
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  return Math.min(86_400, Math.max(0, value))
}

function boundedDuration(
  player: MuxPlayerRef,
  fallback: number | null | undefined,
): number | null {
  const value =
    typeof player.duration === "number" && Number.isFinite(player.duration)
      ? player.duration
      : fallback
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null
  }
  return Math.min(86_400, value)
}

function playbackPosition(
  player: MuxPlayerRef,
  durationFallback: number | null | undefined,
) {
  const positionSeconds = boundedPosition(player)
  const durationSeconds = boundedDuration(player, durationFallback)
  return {
    positionSeconds,
    durationSeconds,
    progress:
      durationSeconds == null
        ? null
        : Math.min(1, Math.max(0, positionSeconds / durationSeconds)),
  }
}

class DefinitivePlaybackError extends Error {
  constructor(
    readonly reason:
      | "binding_invalid"
      | "request_invalid"
      | "admission_rejected",
  ) {
    super()
  }
}

async function postPlayback(
  body: string,
  keepalive: boolean,
): Promise<unknown> {
  return withinRecommendationDeadline(
    undefined,
    REQUEST_DEADLINE_MS,
    async (signal) => {
      const response = await fetch(PLAYBACK_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        keepalive,
        headers: { "content-type": "application/json" },
        body,
        signal,
      })
      if (response.ok) return response.json()
      // Authorization/admission rejection cannot improve by replaying a capability.
      if (response.status === 401 || response.status === 403) {
        throw new DefinitivePlaybackError("admission_rejected")
      }
      if (response.status === 400 || response.status === 409) {
        let value: { error?: unknown } | null = null
        try {
          value = (await response.json()) as { error?: unknown }
        } catch {
          // A malformed error body remains an ambiguous transport failure.
        }
        if (
          response.status === 400 &&
          (value?.error === "playback_request_invalid" ||
            value?.error === "invalid_body")
        ) {
          throw new DefinitivePlaybackError("request_invalid")
        }
        if (
          response.status === 409 &&
          value?.error === "playback_binding_invalid"
        ) {
          throw new DefinitivePlaybackError("binding_invalid")
        }
      }
      throw new RecommendationRuntimeError("request_failed")
    },
  )
}

function playbackFactsBody(
  episode: RecommendationEpisodeCapability,
  mediaId: string,
  events: RecommendationPlaybackEvent[],
) {
  return JSON.stringify({
    action: "facts",
    contractVersion: RECOMMENDATION_EVIDENCE_CONTRACT,
    capability: episode.capability,
    episodeId: episode.episodeId,
    mediaId,
    events,
  })
}

type PlaybackDegradationReason =
  | "body_limit"
  | "binding_invalid"
  | "request_invalid"
  | "admission_rejected"
  | "episode_limit"
  | "integrity_conflict"
  | "pending_claim"
  | "receipt_invalid"
  | "receipt_missing"
  | "transport_exhausted"
  | "transport_retry"

type PlaybackDegradationDisposition = "dropped" | "retrying"

function reportDegradation(
  reason: PlaybackDegradationReason,
  eventIds: string[] = [],
  disposition: PlaybackDegradationDisposition = "dropped",
) {
  window.dispatchEvent(
    new CustomEvent("forge:recommendation-playback-degraded", {
      detail: { reason, disposition, eventIds },
    }),
  )
}

class DefinitiveClaimError extends Error {
  constructor(readonly allowStandaloneFallback: boolean) {
    super()
  }
}

function readRecommendationClaimNonce(): string | null {
  try {
    return sessionStorage.getItem(RECOMMENDATION_TAB_CORRELATION_KEY)
  } catch {
    return null
  }
}

function clearRecommendationClaimNonce(expected: string): void {
  try {
    if (
      sessionStorage.getItem(RECOMMENDATION_TAB_CORRELATION_KEY) === expected
    ) {
      sessionStorage.removeItem(RECOMMENDATION_TAB_CORRELATION_KEY)
    }
  } catch {
    // Session storage is a best-effort transport. A valid in-memory episode
    // capability still allows the current playback facts to be recorded.
  }
}

async function claimRecommendationEpisode(
  body: string,
): Promise<{ episode?: unknown }> {
  return withinRecommendationDeadline(
    undefined,
    REQUEST_DEADLINE_MS,
    async (signal) => {
      const response = await fetch(PLAYBACK_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body,
        signal,
      })
      if (!response.ok) {
        if ([400, 401, 403, 404, 409, 410, 422].includes(response.status)) {
          throw new DefinitiveClaimError(
            response.status !== 401 && response.status !== 403,
          )
        }
        throw new RecommendationRuntimeError("request_failed")
      }
      return (await response.json()) as { episode?: unknown }
    },
  )
}

async function issuePlaybackContext(mediaId: string): Promise<string> {
  const discovery = consumePlaybackDiscoveryContext(mediaId)
  // Automatic identity initialization must precede the episode so preview
  // evidence can bind to the current profile generation. A failed bootstrap
  // still permits anonymous playback evidence and never blocks the player.
  await withinRecommendationDeadline(undefined, REQUEST_DEADLINE_MS, () =>
    waitForRecommendationConsentBootstrap(),
  ).catch(() => undefined)
  return withRecommendationConsentLock(() =>
    withinRecommendationDeadline(
      undefined,
      REQUEST_DEADLINE_MS,
      async (signal) => {
        const response = await fetch(PLAYBACK_ENDPOINT, {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "context",
            mediaId,
            discoverySource: discovery.source,
            provenance: discovery.provenance,
          }),
          signal,
        })
        if (!response.ok) {
          throw new RecommendationRuntimeError("request_failed")
        }
        const value = (await response.json()) as { claimNonce?: unknown }
        if (
          typeof value.claimNonce !== "string" ||
          value.claimNonce.length < 16 ||
          value.claimNonce.length > 191
        ) {
          throw new RecommendationRuntimeError("claim_invalid")
        }
        return value.claimNonce
      },
    ),
  )
}

export function RecommendationPlaybackRecorder({
  player,
  initiation,
  mediaId,
  durationSeconds,
  viewable = null,
}: {
  player: MuxPlayerRef | null
  initiation: "manual" | "automatic" | null
  mediaId: string
  durationSeconds?: number | null
  viewable?: boolean | null
}) {
  const initiationRef = useRef(initiation)
  const durationRef = useRef(durationSeconds)
  const viewableRef = useRef(viewable)
  const sampleViewingModeRef = useRef<() => void>(() => undefined)
  const viewingModeObservedRef = useRef(false)
  const lifecycleGenerationRef = useRef(0)
  const observationsEnabledRef = useRef(true)
  const observationCountsRef = useRef({ navigation: 0, qoe: 0, seek: 0 })
  const observeInitiationRef = useRef<() => void>(() => undefined)
  const attemptedAtRef = useRef<number | null>(null)
  const bufferingRef = useRef(false)
  const bfcacheSuspendedRef = useRef(false)
  const episodeRef = useRef<RecommendationEpisodeCapability | null>(null)
  const claimStartedRef = useRef(false)
  const claimSettledRef = useRef(false)
  const pendingRef = useRef<RecommendationPlaybackEvent[]>([])
  const outboundRef = useRef<RecommendationPlaybackEvent[]>([])
  const flushScheduledRef = useRef(false)
  const drainingRef = useRef(false)
  const drainRequestedRef = useRef(false)
  const retryTimerRef = useRef<number | null>(null)
  const deliveryAttemptsRef = useRef(new Map<string, number>())
  const sendOutboundRef = useRef<() => void>(() => undefined)
  const factCountRef = useRef(0)
  const factKindCountsRef = useRef<
    Partial<Record<RecommendationPlaybackEvent["kind"], number>>
  >({})
  const attemptRecordedRef = useRef(false)
  const startRecordedRef = useRef(false)
  const terminalRecordedRef = useRef(false)
  const playingRef = useRef(false)
  const bfcacheWasPlayingRef = useRef(false)
  const activeStartedAtRef = useRef<number | null>(null)
  const playbackStartedAtRef = useRef<number | null>(null)
  const lastProgressAtRef = useRef<number | null>(null)
  const seekFromRef = useRef<number | null>(null)
  const lastPositionRef = useRef<number | null>(null)
  useEffect(() => {
    initiationRef.current = initiation
    sampleViewingModeRef.current()
    observeInitiationRef.current()
  }, [initiation])
  useEffect(() => {
    viewableRef.current = viewable
    sampleViewingModeRef.current()
  }, [viewable])
  useEffect(() => {
    durationRef.current = durationSeconds
  }, [durationSeconds])

  const sendOutbound = useCallback(() => {
    if (flushScheduledRef.current || !episodeRef.current) return
    flushScheduledRef.current = true
    queueMicrotask(() => {
      flushScheduledRef.current = false
      const episode = episodeRef.current
      if (!episode || drainingRef.current) return
      drainingRef.current = true

      void (async () => {
        while (outboundRef.current.length > 0) {
          const events: RecommendationPlaybackEvent[] = []
          while (
            events.length < outboundRef.current.length &&
            events.length < RECOMMENDATION_PLAYBACK_EVENT_LIMIT
          ) {
            const candidate = outboundRef.current[events.length]!
            const candidateBody = playbackFactsBody(episode, mediaId, [
              ...events,
              candidate,
            ])
            if (
              UTF8_ENCODER.encode(candidateBody).byteLength >
              RECOMMENDATION_PLAYBACK_BODY_BYTES
            ) {
              if (events.length === 0) {
                const dropped = outboundRef.current.shift()
                if (dropped) {
                  deliveryAttemptsRef.current.delete(dropped.eventId)
                  reportDegradation("body_limit", [dropped.eventId])
                }
              }
              break
            }
            events.push(candidate)
          }
          if (events.length === 0) continue
          for (const fact of events) {
            deliveryAttemptsRef.current.set(
              fact.eventId,
              (deliveryAttemptsRef.current.get(fact.eventId) ?? 0) + 1,
            )
          }
          const body = playbackFactsBody(episode, mediaId, events)
          let receiptInvalid = false
          try {
            const acknowledgement = await postPlayback(body, true)
            const submittedIds = new Set(events.map((fact) => fact.eventId))
            const receipts = parseRecommendationPlaybackReceipts(
              acknowledgement,
              submittedIds,
            )
            if (!receipts) {
              receiptInvalid = true
              throw new RecommendationRuntimeError("request_failed")
            }
            const retired = new Set<string>()
            for (const receipt of receipts) {
              retired.add(receipt.eventId)
              deliveryAttemptsRef.current.delete(receipt.eventId)
              if (receipt.status === "conflict") {
                reportDegradation("integrity_conflict", [receipt.eventId])
              }
            }
            outboundRef.current = outboundRef.current.filter(
              (fact) => !retired.has(fact.eventId),
            )
            const missing = events.filter((fact) => !retired.has(fact.eventId))
            if (missing.length > 0) {
              const exhausted = missing.filter(
                (fact) =>
                  (deliveryAttemptsRef.current.get(fact.eventId) ?? 0) >=
                  MAX_FACT_DELIVERY_ATTEMPTS,
              )
              if (exhausted.length > 0) {
                const exhaustedIds = new Set(
                  exhausted.map((fact) => fact.eventId),
                )
                outboundRef.current = outboundRef.current.filter(
                  (fact) => !exhaustedIds.has(fact.eventId),
                )
                for (const eventId of exhaustedIds) {
                  deliveryAttemptsRef.current.delete(eventId)
                }
                reportDegradation("receipt_missing", [...exhaustedIds])
              }
              const retrying = missing.filter(
                (fact) =>
                  !exhausted.some(({ eventId }) => eventId === fact.eventId),
              )
              if (retrying.length > 0) {
                reportDegradation(
                  "receipt_missing",
                  retrying.map((fact) => fact.eventId),
                  "retrying",
                )
              }
              if (outboundRef.current.length > 0) {
                const attempt = Math.max(
                  ...missing.map(
                    (fact) =>
                      deliveryAttemptsRef.current.get(fact.eventId) ?? 1,
                  ),
                )
                retryTimerRef.current = window.setTimeout(
                  () => sendOutboundRef.current(),
                  FACT_RETRY_BACKOFF_MS * 2 ** (attempt - 1),
                )
                break
              }
            }
          } catch (error) {
            if (
              error instanceof DefinitivePlaybackError &&
              error.reason === "request_invalid" &&
              events.some(isObservationEvent)
            ) {
              // Schema validation rejects the complete batch before ingestion.
              // Preserve baseline event IDs AND payloads: an earlier ambiguous
              // delivery may already have committed them on a newer Admin pod.
              observationsEnabledRef.current = false
              const dropped = outboundRef.current.filter(isObservationEvent)
              outboundRef.current = outboundRef.current.filter(
                (fact) => !isObservationEvent(fact),
              )
              for (const fact of dropped)
                deliveryAttemptsRef.current.delete(fact.eventId)
              reportDegradation(
                "request_invalid",
                dropped.map((fact) => fact.eventId),
              )
              continue
            }
            if (error instanceof DefinitivePlaybackError) {
              const dropped = outboundRef.current.splice(0)
              episodeRef.current = null
              claimSettledRef.current = true
              drainRequestedRef.current = false
              for (const fact of dropped) {
                deliveryAttemptsRef.current.delete(fact.eventId)
              }
              reportDegradation(
                error.reason,
                dropped.map((fact) => fact.eventId),
              )
              break
            }
            const exhausted = events.filter(
              (fact) =>
                (deliveryAttemptsRef.current.get(fact.eventId) ?? 0) >=
                MAX_FACT_DELIVERY_ATTEMPTS,
            )
            if (exhausted.length > 0) {
              const exhaustedIds = new Set(
                exhausted.map((fact) => fact.eventId),
              )
              outboundRef.current = outboundRef.current.filter(
                (fact) => !exhaustedIds.has(fact.eventId),
              )
              for (const eventId of exhaustedIds) {
                deliveryAttemptsRef.current.delete(eventId)
              }
              reportDegradation(
                receiptInvalid ? "receipt_invalid" : "transport_exhausted",
                [...exhaustedIds],
              )
            } else {
              reportDegradation(
                receiptInvalid ? "receipt_invalid" : "transport_retry",
                events.map((fact) => fact.eventId),
                "retrying",
              )
            }
            if (outboundRef.current.length > 0) {
              const attempt = Math.max(
                ...events.map(
                  (fact) => deliveryAttemptsRef.current.get(fact.eventId) ?? 1,
                ),
              )
              retryTimerRef.current = window.setTimeout(
                () => sendOutboundRef.current(),
                FACT_RETRY_BACKOFF_MS * 2 ** (attempt - 1),
              )
            }
            break
          }
        }
      })().finally(() => {
        drainingRef.current = false
        if (drainRequestedRef.current && outboundRef.current.length > 0) {
          drainRequestedRef.current = false
          queueMicrotask(() => sendOutboundRef.current())
        }
      })
    })
  }, [mediaId])
  useEffect(() => {
    sendOutboundRef.current = sendOutbound
    return () => {
      if (retryTimerRef.current != null) {
        window.clearTimeout(retryTimerRef.current)
      }
    }
  }, [sendOutbound])

  const enqueue = useCallback(
    (next: RecommendationPlaybackEvent, terminal = false) => {
      if (terminalRecordedRef.current && !terminal) return
      if (isObservationEvent(next) && !observationsEnabledRef.current) return
      if (next.kind === "playback_seek")
        observationCountsRef.current.seek = Math.min(
          65535,
          observationCountsRef.current.seek + 1,
        )
      if (next.kind === "playback_navigation")
        observationCountsRef.current.navigation = Math.min(
          65535,
          observationCountsRef.current.navigation + 1,
        )
      if (next.kind === "playback_qoe")
        observationCountsRef.current.qoe = Math.min(
          65535,
          observationCountsRef.current.qoe + 1,
        )
      // Optional observations cannot consume the pending slots reserved for
      // attempt/start, active-time and terminal evidence during a slow claim.
      if (
        (next.kind === "playback_navigation" ||
          next.kind === "playback_qoe" ||
          next.kind === "playback_viewing_mode") &&
        !episodeRef.current &&
        pendingRef.current.length >= 8
      ) {
        reportDegradation("pending_claim", [next.eventId])
        return
      }
      const factLimit = terminal ? MAX_EPISODE_FACTS : MAX_EPISODE_FACTS - 1
      const kindCount = factKindCountsRef.current[next.kind] ?? 0
      if (
        factCountRef.current >= factLimit ||
        kindCount >= MAX_FACTS_BY_KIND[next.kind]
      ) {
        reportDegradation("episode_limit", [next.eventId])
        return
      }
      const registerFact = () => {
        factCountRef.current += 1
        factKindCountsRef.current[next.kind] = kindCount + 1
      }
      if (!episodeRef.current) {
        if (claimSettledRef.current) return
        const limit = terminal
          ? MAX_PENDING_CLAIM_FACTS
          : MAX_PENDING_REGULAR_FACTS
        if (pendingRef.current.length >= limit) {
          reportDegradation("pending_claim", [next.eventId])
          return
        }
        pendingRef.current.push(next)
        registerFact()
        return
      }
      if (terminal && drainingRef.current) {
        registerFact()
        // Keep terminal truth in the ordered queue until the serialized drain
        // commits it. The direct keepalive is only a best-effort page-exit
        // fast path; a failed/stalled earlier drain must not drop the terminal
        // fact or its stable idempotency key.
        outboundRef.current.push(next)
        drainRequestedRef.current = true
        const body = playbackFactsBody(episodeRef.current, mediaId, [next])
        void postPlayback(body, true).catch(() => undefined)
        return
      }
      outboundRef.current.push(next)
      registerFact()
      sendOutbound()
    },
    [mediaId, sendOutbound],
  )

  useEffect(() => {
    if (claimStartedRef.current) return
    claimStartedRef.current = true
    const recommendationClaimNonce = readRecommendationClaimNonce()

    const abandonPendingClaim = () => {
      pendingRef.current = []
      claimSettledRef.current = true
    }
    const attemptClaim = (
      claimNonce: string,
      attempt: number,
      allowStandaloneFallback: boolean,
    ) => {
      const body = JSON.stringify({ action: "claim", claimNonce, mediaId })
      void claimRecommendationEpisode(body)
        .then((value) => {
          const episode = parseRecommendationEpisodeCapability(value.episode)
          if (!episode) throw new RecommendationRuntimeError("claim_invalid")
          if (recommendationClaimNonce) {
            clearRecommendationClaimNonce(recommendationClaimNonce)
          }
          episodeRef.current = episode
          claimSettledRef.current = true
          outboundRef.current.push(...pendingRef.current.splice(0))
          sendOutbound()
        })
        .catch((error) => {
          if (error instanceof DefinitiveClaimError) {
            clearRecommendationClaimNonce(claimNonce)
            if (allowStandaloneFallback && error.allowStandaloneFallback) {
              void issuePlaybackContext(mediaId)
                .then((fallbackNonce) => attemptClaim(fallbackNonce, 1, false))
                .catch(abandonPendingClaim)
              return
            }
            abandonPendingClaim()
            return
          }
          if (attempt < MAX_CLAIM_ATTEMPTS) {
            window.setTimeout(() => {
              attemptClaim(claimNonce, attempt + 1, allowStandaloneFallback)
            }, CLAIM_RETRY_BACKOFF_MS)
          }
          // Ambiguous failures retain both the nonce and the exact pending
          // fact identities. A same-binding retry can recover a claim that
          // committed before its response was lost.
        })
    }
    if (recommendationClaimNonce) {
      attemptClaim(recommendationClaimNonce, 1, true)
      return
    }
    void issuePlaybackContext(mediaId)
      .then((claimNonce) => attemptClaim(claimNonce, 1, false))
      .catch(() => {
        // Telemetry is strictly fail-open: the player and legacy Watch event
        // recorder remain available when context issuance is degraded.
        abandonPendingClaim()
      })
  }, [mediaId, sendOutbound])

  useEffect(() => {
    if (!player) return
    let suspended = false
    let seeking = false
    let waiting = false
    const wallClockOrigin = Date.now() - performance.now()
    const recorder = createViewingModeRecorder({
      now: () => performance.now(),
      read: () => ({
        positionSeconds: player.currentTime,
        durationSeconds: durationRef.current ?? null,
        playing:
          !suspended &&
          player.paused === false &&
          !seeking &&
          !waiting &&
          player.readyState >= 3,
        visible:
          document.visibilityState === "visible" ? viewableRef.current : false,
        mode:
          player.muted === true || player.volume === 0
            ? "sound_off"
            : player.muted === false &&
                Number.isFinite(player.volume) &&
                player.volume > 0
              ? "sound_on"
              : null,
        preview: initiationRef.current == null,
        playbackRate: player.playbackRate,
      }),
      emit: (payload, endedAt) => {
        viewingModeObservedRef.current = true
        enqueue(
          event<
            Extract<
              RecommendationPlaybackEvent,
              { kind: "playback_viewing_mode" }
            >
          >(
            {
              kind: "playback_viewing_mode",
              payload,
            },
            new Date(wallClockOrigin + endedAt),
          ),
        )
      },
    })
    sampleViewingModeRef.current = recorder.sample
    const sample = (event?: Event) => {
      if (event?.type === "seeking") seeking = true
      if (event?.type === "seeked") seeking = false
      if (
        event?.type === "waiting" ||
        event?.type === "stalled" ||
        event?.type === "error"
      )
        waiting = true
      if (event?.type === "playing") waiting = false
      recorder.sample()
    }
    const hide = () => {
      suspended = true
      recorder.flush()
    }
    const show = () => {
      suspended = false
      recorder.sample()
    }
    const events = [
      "timeupdate",
      "playing",
      "pause",
      "waiting",
      "stalled",
      "seeking",
      "seeked",
      "volumechange",
      "ratechange",
      "ended",
      "error",
    ]
    for (const name of events) player.addEventListener(name, sample)
    document.addEventListener("visibilitychange", sample)
    window.addEventListener("pagehide", hide)
    window.addEventListener("pageshow", show)
    recorder.sample()
    return () => {
      recorder.flush()
      sampleViewingModeRef.current = () => undefined
      for (const name of events) player.removeEventListener(name, sample)
      document.removeEventListener("visibilitychange", sample)
      window.removeEventListener("pagehide", hide)
      window.removeEventListener("pageshow", show)
    }
  }, [player, enqueue])

  useEffect(() => {
    if (!player) return
    const lifecycleGeneration = ++lifecycleGenerationRef.current

    const canMeasureVisibility = typeof document.visibilityState === "string"
    const canMeasurePlayerState = typeof player.paused === "boolean"
    const isVisible = () =>
      !canMeasureVisibility || document.visibilityState === "visible"

    const startActive = () => {
      if (
        terminalRecordedRef.current ||
        activeStartedAtRef.current != null ||
        initiationRef.current == null ||
        !playingRef.current ||
        (canMeasurePlayerState && player.paused) ||
        !isVisible()
      ) {
        return
      }
      activeStartedAtRef.current = Date.now()
    }

    const flushActive = () => {
      const startedAt = activeStartedAtRef.current
      activeStartedAtRef.current = null
      if (startedAt == null) return
      const endedAt = Date.now()
      let activeMilliseconds = Math.max(0, endedAt - startedAt)
      let emittedMilliseconds = 0
      while (activeMilliseconds > 0) {
        const chunk = Math.min(MAX_ACTIVE_CHUNK_MS, activeMilliseconds)
        enqueue(
          event<
            Extract<
              RecommendationPlaybackEvent,
              { kind: "playback_active_visible_playing" }
            >
          >(
            {
              kind: "playback_active_visible_playing",
              payload:
                canMeasureVisibility && canMeasurePlayerState
                  ? { activeMilliseconds: chunk, coverage: "complete" }
                  : {
                      activeMilliseconds: chunk,
                      coverage: "partial",
                      missingReason: canMeasureVisibility
                        ? "player_state_unavailable"
                        : "visibility_unavailable",
                    },
            },
            new Date(startedAt + emittedMilliseconds + chunk),
          ),
        )
        emittedMilliseconds += chunk
        activeMilliseconds -= chunk
      }
      if (
        playingRef.current &&
        isVisible() &&
        (!canMeasurePlayerState || !player.paused)
      ) {
        activeStartedAtRef.current = Date.now()
      }
    }

    const recordAttempt = () => {
      if (attemptRecordedRef.current || initiationRef.current == null) {
        return
      }
      attemptRecordedRef.current = true
      attemptedAtRef.current ??= Date.now()
      enqueue(
        event<
          Extract<RecommendationPlaybackEvent, { kind: "playback_attempt" }>
        >(
          {
            kind: "playback_attempt",
            payload: {
              initiation: initiationRef.current,
            },
          },
          new Date(attemptedAtRef.current),
        ),
      )
    }

    const navigation = (
      action: Extract<
        RecommendationPlaybackEvent,
        { kind: "playback_navigation" }
      >["payload"]["action"],
    ) => {
      if (!terminalRecordedRef.current) recordAttempt()
      if (!attemptRecordedRef.current || terminalRecordedRef.current) return
      enqueue(
        event<
          Extract<RecommendationPlaybackEvent, { kind: "playback_navigation" }>
        >({
          kind: "playback_navigation",
          payload: {
            action,
            cause: "unknown",
            positionSeconds: boundedPosition(player),
          },
        }),
      )
    }
    const qoe = (
      action: Extract<
        RecommendationPlaybackEvent,
        { kind: "playback_qoe" }
      >["payload"]["action"],
    ) => {
      if (!attemptRecordedRef.current || terminalRecordedRef.current) return
      enqueue(
        event<Extract<RecommendationPlaybackEvent, { kind: "playback_qoe" }>>({
          kind: "playback_qoe",
          payload: {
            action,
            cause: "unknown",
            positionSeconds: boundedPosition(player),
          },
        }),
      )
    }
    const onPlay = () => recordAttempt()
    const onPlaying = () => {
      if (initiationRef.current == null) return
      recordAttempt()
      if (bufferingRef.current) {
        qoe("buffering_end")
        bufferingRef.current = false
      } else if (startRecordedRef.current && !playingRef.current)
        navigation("resume")
      playingRef.current = true
      lastPositionRef.current = boundedPosition(player)
      if (!startRecordedRef.current) {
        startRecordedRef.current = true
        const now = Date.now()
        playbackStartedAtRef.current = now
        lastProgressAtRef.current = now
        enqueue(
          event<
            Extract<RecommendationPlaybackEvent, { kind: "playback_start" }>
          >({
            kind: "playback_start",
            payload: { positionSeconds: boundedPosition(player) },
          }),
        )
      }
      startActive()
    }
    const onPause = () => {
      if (playingRef.current || bufferingRef.current) navigation("pause")
      if (bufferingRef.current) qoe("buffering_end")
      bufferingRef.current = false
      playingRef.current = false
      flushActive()
    }
    const onBuffering = (action: "waiting" | "stalled") => {
      if (bufferingRef.current || !attemptRecordedRef.current) return
      bufferingRef.current = true
      qoe(action)
      playingRef.current = false
      flushActive()
    }
    const onWaiting = () => onBuffering("waiting")
    const onStalled = () => onBuffering("stalled")
    const onTimeUpdate = () => {
      if (seekFromRef.current == null)
        lastPositionRef.current = boundedPosition(player)
      const now = Date.now()
      if (
        playbackStartedAtRef.current == null ||
        lastProgressAtRef.current == null ||
        now - lastProgressAtRef.current < PROGRESS_INTERVAL_MS
      ) {
        return
      }
      lastProgressAtRef.current = now
      if (
        activeStartedAtRef.current != null &&
        now - activeStartedAtRef.current >= MAX_ACTIVE_CHUNK_MS
      ) {
        flushActive()
      }
      enqueue(
        event<
          Extract<RecommendationPlaybackEvent, { kind: "playback_progress" }>
        >({
          kind: "playback_progress",
          payload: {
            ...playbackPosition(player, durationRef.current),
            wallElapsedMilliseconds: Math.min(
              6 * 60 * 60 * 1_000,
              Math.max(0, now - playbackStartedAtRef.current),
            ),
          },
        }),
      )
    }
    const onSeeking = () => {
      // Native seeking fires after currentTime changes. Use the last observed
      // position rather than reporting the seek target as both endpoints.
      seekFromRef.current ??= lastPositionRef.current ?? boundedPosition(player)
    }
    const onSeeked = () => {
      const fromSeconds = seekFromRef.current
      seekFromRef.current = null
      lastPositionRef.current = boundedPosition(player)
      if (fromSeconds == null || !startRecordedRef.current) return
      enqueue(
        event<Extract<RecommendationPlaybackEvent, { kind: "playback_seek" }>>({
          kind: "playback_seek",
          payload: { fromSeconds, toSeconds: boundedPosition(player) },
        }),
      )
    }
    const recordObservation = (errorObserved: boolean) => {
      const playerState = bufferingRef.current
        ? "buffering"
        : canMeasurePlayerState
          ? player.paused
            ? "paused"
            : "playing"
          : "unknown"
      enqueue(
        event<
          Extract<RecommendationPlaybackEvent, { kind: "playback_observation" }>
        >({
          kind: "playback_observation",
          payload: {
            version: "playback-observations-v1",
            elapsedMilliseconds: Math.min(
              6 * 60 * 60 * 1000,
              Math.max(0, Date.now() - (attemptedAtRef.current ?? Date.now())),
            ),
            visibility: canMeasureVisibility
              ? isVisible()
                ? "visible"
                : "hidden"
              : "unknown",
            playerState,
            startObserved: startRecordedRef.current,
            errorObserved,
            seekCount: observationCountsRef.current.seek,
            navigationCount: observationCountsRef.current.navigation,
            qoeCount: observationCountsRef.current.qoe,
          },
        }),
      )
    }
    const recordEnd = (reason: EndReason, completed = false) => {
      if (!terminalRecordedRef.current && !bfcacheSuspendedRef.current)
        recordAttempt()
      if (
        terminalRecordedRef.current ||
        !attemptRecordedRef.current ||
        bfcacheSuspendedRef.current
      )
        return
      playingRef.current = false
      flushActive()
      recordObservation(false)
      terminalRecordedRef.current = true
      enqueue(
        event<Extract<RecommendationPlaybackEvent, { kind: "playback_end" }>>({
          kind: "playback_end",
          payload: {
            reason,
            ...playbackPosition(player, durationRef.current),
            completed,
          },
        }),
        true,
      )
    }
    const onEnded = () => recordEnd("ended", true)
    const onError = () => {
      if (!terminalRecordedRef.current) recordAttempt()
      if (
        terminalRecordedRef.current ||
        (!startRecordedRef.current &&
          !attemptRecordedRef.current &&
          !viewingModeObservedRef.current)
      ) {
        return
      }
      playingRef.current = false
      flushActive()
      recordObservation(true)
      terminalRecordedRef.current = true
      enqueue(
        event<Extract<RecommendationPlaybackEvent, { kind: "playback_error" }>>(
          {
            kind: "playback_error",
            payload: {
              code: "media_error",
              positionSeconds: boundedPosition(player),
            },
          },
        ),
        true,
      )
    }
    const onPageHide = (event: PageTransitionEvent) => {
      if (event.persisted) {
        navigation("bfcache_suspend")
        bfcacheSuspendedRef.current = true
        bfcacheWasPlayingRef.current = playingRef.current
        playingRef.current = false
        flushActive()
      } else recordEnd("pagehide")
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      bfcacheSuspendedRef.current = false
      navigation("bfcache_resume")
      playingRef.current =
        bfcacheWasPlayingRef.current &&
        (!canMeasurePlayerState || !player.paused)
      bfcacheWasPlayingRef.current = false
      startActive()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        navigation("hidden")
        flushActive()
      } else {
        navigation("visible")
        startActive()
      }
    }

    player.addEventListener("play", onPlay)
    player.addEventListener("playing", onPlaying)
    player.addEventListener("pause", onPause)
    player.addEventListener("waiting", onWaiting)
    player.addEventListener("stalled", onStalled)
    player.addEventListener("timeupdate", onTimeUpdate)
    player.addEventListener("seeking", onSeeking)
    player.addEventListener("seeked", onSeeked)
    player.addEventListener("ended", onEnded)
    player.addEventListener("error", onError)
    window.addEventListener("pagehide", onPageHide)
    window.addEventListener("pageshow", onPageShow)
    document.addEventListener("visibilitychange", onVisibilityChange)
    // Intent may arrive after preview playback. Updating intent or duration
    // must not tear down this lifecycle and manufacture a route departure.
    observeInitiationRef.current = () => {
      if (initiationRef.current == null) return
      attemptedAtRef.current ??= Date.now()
      if (!player.paused) onPlaying()
    }
    observeInitiationRef.current()

    const finalizeDeparture = () => {
      if (lifecycleGenerationRef.current === lifecycleGeneration)
        recordEnd("route_exit")
    }
    return () => {
      observeInitiationRef.current = () => undefined
      playingRef.current = false
      flushActive()
      // StrictMode replays setup/cleanup without a departure. A replacement
      // setup invalidates this callback; a genuine unmount keeps its generation.
      queueMicrotask(finalizeDeparture)
      player.removeEventListener("play", onPlay)
      player.removeEventListener("playing", onPlaying)
      player.removeEventListener("pause", onPause)
      player.removeEventListener("waiting", onWaiting)
      player.removeEventListener("stalled", onStalled)
      player.removeEventListener("timeupdate", onTimeUpdate)
      player.removeEventListener("seeking", onSeeking)
      player.removeEventListener("seeked", onSeeked)
      player.removeEventListener("ended", onEnded)
      player.removeEventListener("error", onError)
      window.removeEventListener("pagehide", onPageHide)
      window.removeEventListener("pageshow", onPageShow)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [enqueue, mediaId, player])

  return null
}

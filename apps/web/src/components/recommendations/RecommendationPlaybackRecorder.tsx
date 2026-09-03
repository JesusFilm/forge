"use client"

import { useCallback, useEffect, useRef } from "react"
import type { MuxPlayerRef } from "@forge/video-player"

import {
  RECOMMENDATION_EVIDENCE_CONTRACT,
  RECOMMENDATION_PLAYBACK_BODY_BYTES,
  RECOMMENDATION_PLAYBACK_EVENT_LIMIT,
  RECOMMENDATION_TAB_CORRELATION_KEY,
  parseRecommendationEpisodeCapability,
  type RecommendationEpisodeCapability,
  type RecommendationPlaybackEvent,
} from "@/lib/recommendation-contracts"
import {
  recommendationEventId,
  recommendationFetchWithRetry,
  withinRecommendationDeadline,
} from "@/lib/recommendation-browser"
import { RecommendationRuntimeError } from "@/lib/recommendation-errors"
import { consumePlaybackDiscoveryContext } from "@/lib/playback-discovery"
import { watchPath } from "@/lib/watch-paths"

const PLAYBACK_ENDPOINT = watchPath("/api/recommendations/playback")
const REQUEST_DEADLINE_MS = 1_000
const MAX_CLAIM_ATTEMPTS = 3
const CLAIM_RETRY_BACKOFF_MS = 250
const MAX_EPISODE_FACTS = 128
const MAX_PENDING_CLAIM_FACTS = 16
const MAX_PENDING_REGULAR_FACTS = MAX_PENDING_CLAIM_FACTS - 1
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
  playback_active_visible_playing: 64,
  playback_end: 1,
  playback_error: 1,
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

async function postPlayback(body: string, keepalive: boolean) {
  return recommendationFetchWithRetry(
    PLAYBACK_ENDPOINT,
    {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      keepalive,
      headers: { "content-type": "application/json" },
      body,
    },
    REQUEST_DEADLINE_MS,
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

function reportOverflow(reason: "pending_claim" | "episode_limit") {
  window.dispatchEvent(
    new CustomEvent("forge:recommendation-playback-overflow", {
      detail: { reason },
    }),
  )
}

class DefinitiveClaimError extends Error {}

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
          throw new DefinitiveClaimError()
        }
        throw new RecommendationRuntimeError("request_failed")
      }
      return (await response.json()) as { episode?: unknown }
    },
  )
}

async function issuePlaybackContext(mediaId: string): Promise<string> {
  const discovery = consumePlaybackDiscoveryContext(mediaId)
  return withinRecommendationDeadline(
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
      if (!response.ok) throw new RecommendationRuntimeError("request_failed")
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
  )
}

export function RecommendationPlaybackRecorder({
  player,
  initiation,
  mediaId,
  durationSeconds,
}: {
  player: MuxPlayerRef | null
  initiation: "manual" | "automatic" | null
  mediaId: string
  durationSeconds?: number | null
}) {
  const initiationRef = useRef(initiation)
  const episodeRef = useRef<RecommendationEpisodeCapability | null>(null)
  const claimStartedRef = useRef(false)
  const claimSettledRef = useRef(false)
  const pendingRef = useRef<RecommendationPlaybackEvent[]>([])
  const outboundRef = useRef<RecommendationPlaybackEvent[]>([])
  const flushScheduledRef = useRef(false)
  const drainingRef = useRef(false)
  const drainRequestedRef = useRef(false)
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
  useEffect(() => {
    initiationRef.current = initiation
  }, [initiation])

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
              if (events.length === 0) outboundRef.current.shift()
              break
            }
            events.push(candidate)
          }
          if (events.length === 0) continue
          const body = playbackFactsBody(episode, mediaId, events)
          try {
            await postPlayback(body, true)
            outboundRef.current.splice(0, events.length)
          } catch {
            // Preserve the exact event IDs and payloads. A later player fact or
            // lifecycle flush can replay the same idempotent batch.
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
  }, [sendOutbound])

  const enqueue = useCallback(
    (next: RecommendationPlaybackEvent, terminal = false) => {
      if (terminalRecordedRef.current && !terminal) return
      const factLimit = terminal ? MAX_EPISODE_FACTS : MAX_EPISODE_FACTS - 1
      const kindCount = factKindCountsRef.current[next.kind] ?? 0
      if (
        factCountRef.current >= factLimit ||
        kindCount >= MAX_FACTS_BY_KIND[next.kind]
      ) {
        reportOverflow("episode_limit")
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
          reportOverflow("pending_claim")
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
            if (allowStandaloneFallback) {
              clearRecommendationClaimNonce(claimNonce)
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
      enqueue(
        event<
          Extract<RecommendationPlaybackEvent, { kind: "playback_attempt" }>
        >({
          kind: "playback_attempt",
          payload: { initiation: initiationRef.current },
        }),
      )
    }

    const onPlay = () => recordAttempt()
    const onPlaying = () => {
      if (initiationRef.current == null) return
      recordAttempt()
      playingRef.current = true
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
      playingRef.current = false
      flushActive()
    }
    const onBuffering = () => {
      playingRef.current = false
      flushActive()
    }
    const onTimeUpdate = () => {
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
            ...playbackPosition(player, durationSeconds),
            wallElapsedMilliseconds: Math.min(
              6 * 60 * 60 * 1_000,
              Math.max(0, now - playbackStartedAtRef.current),
            ),
          },
        }),
      )
    }
    const onSeeking = () => {
      seekFromRef.current = boundedPosition(player)
    }
    const onSeeked = () => {
      const fromSeconds = seekFromRef.current
      seekFromRef.current = null
      if (fromSeconds == null || !startRecordedRef.current) return
      enqueue(
        event<Extract<RecommendationPlaybackEvent, { kind: "playback_seek" }>>({
          kind: "playback_seek",
          payload: { fromSeconds, toSeconds: boundedPosition(player) },
        }),
      )
    }
    const recordEnd = (reason: EndReason, completed = false) => {
      if (terminalRecordedRef.current || !startRecordedRef.current) return
      playingRef.current = false
      flushActive()
      terminalRecordedRef.current = true
      enqueue(
        event<Extract<RecommendationPlaybackEvent, { kind: "playback_end" }>>({
          kind: "playback_end",
          payload: {
            reason,
            ...playbackPosition(player, durationSeconds),
            completed,
          },
        }),
        true,
      )
    }
    const onEnded = () => recordEnd("ended", true)
    const onError = () => {
      if (
        terminalRecordedRef.current ||
        (!startRecordedRef.current && !attemptRecordedRef.current)
      ) {
        return
      }
      playingRef.current = false
      flushActive()
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
        bfcacheWasPlayingRef.current = playingRef.current
        playingRef.current = false
        flushActive()
      } else recordEnd("pagehide")
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      playingRef.current =
        bfcacheWasPlayingRef.current &&
        (!canMeasurePlayerState || !player.paused)
      bfcacheWasPlayingRef.current = false
      startActive()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushActive()
      else startActive()
    }

    player.addEventListener("play", onPlay)
    player.addEventListener("playing", onPlaying)
    player.addEventListener("pause", onPause)
    player.addEventListener("waiting", onBuffering)
    player.addEventListener("stalled", onBuffering)
    player.addEventListener("timeupdate", onTimeUpdate)
    player.addEventListener("seeking", onSeeking)
    player.addEventListener("seeked", onSeeked)
    player.addEventListener("ended", onEnded)
    player.addEventListener("error", onError)
    window.addEventListener("pagehide", onPageHide)
    window.addEventListener("pageshow", onPageShow)
    document.addEventListener("visibilitychange", onVisibilityChange)
    if (initiation != null && !player.paused) onPlaying()

    return () => {
      recordEnd("route_exit")
      player.removeEventListener("play", onPlay)
      player.removeEventListener("playing", onPlaying)
      player.removeEventListener("pause", onPause)
      player.removeEventListener("waiting", onBuffering)
      player.removeEventListener("stalled", onBuffering)
      player.removeEventListener("timeupdate", onTimeUpdate)
      player.removeEventListener("seeking", onSeeking)
      player.removeEventListener("seeked", onSeeked)
      player.removeEventListener("ended", onEnded)
      player.removeEventListener("error", onError)
      window.removeEventListener("pagehide", onPageHide)
      window.removeEventListener("pageshow", onPageShow)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [durationSeconds, enqueue, initiation, mediaId, player])

  return null
}

/**
 * The playback episode recorder (feat-516): one per media session the root
 * host owns. It claims an episode — from a pending selection nonce when the
 * viewer arrived from a slate, otherwise from a freshly issued playback
 * context — buffers the facts that arrive before the claim settles, then
 * batches strict playback facts to Admin under the episode capability.
 *
 * Mirrors Web's `RecommendationPlaybackRecorder` decisions (caps, pending
 * slots, retry ladder, observation gating) so both clients feed the same
 * profile pipeline the same way. Pure: every side effect is an injected dep.
 */
import {
  RecommendationClientError,
  rateLimitDelayMs,
  toRecommendationClientError,
} from "./errors"
import type { PlaybackDiscovery } from "./playbackDiscovery"
import {
  CLAIM_RETRY_BACKOFF_MS,
  FACT_RETRY_BACKOFF_MS,
  MAX_ACTIVE_CHUNK_MS,
  MAX_CLAIM_ATTEMPTS,
  MAX_CLAIM_RATE_LIMIT_DEFERRALS,
  MAX_EPISODE_FACTS,
  MAX_FACTS_BY_KIND,
  MAX_FACT_DELIVERY_ATTEMPTS,
  MAX_FACT_RATE_LIMIT_DEFERRALS,
  MAX_PENDING_CLAIM_FACTS,
  PROGRESS_INTERVAL_MS,
  SEEK_JUMP_THRESHOLD_S,
  boundedPosition,
  boundedWallMs,
  buildPlaybackFactsVariables,
  isObservationFact,
  parsePlaybackEpisode,
  playbackPosition,
  takeBatch,
  type PlaybackEpisode,
  type PlaybackFact,
  type PlaybackFactKind,
  type PlaybackFactsVariables,
  type PlaybackNavigationAction,
  type PlaybackQoeAction,
} from "./playbackFacts"
import { randomEventId } from "./random"
import type { PendingRecommendationClaim } from "./selection"
import { reportRecommendationPlaybackDegraded } from "./telemetry"
import type {
  RecommendationIdentity,
  ViewerIdentityResult,
} from "./viewerIdentity"

export type PlaybackFactReceipt = {
  eventId: string
  status: string
  sequence: number
}

export type PlaybackRecorderDeps = {
  mediaId: string
  /** Keys a surface may have marked the discovery under (slug, media id). */
  discoveryKeys: ReadonlyArray<string | null | undefined>
  takePendingNonce: (mediaId: string) => string | null
  restorePendingNonce: (claim: PendingRecommendationClaim) => void
  takeDiscovery: (
    keys: ReadonlyArray<string | null | undefined>,
  ) => PlaybackDiscovery
  getIdentity: () => Promise<ViewerIdentityResult>
  claimEpisode: (
    identity: RecommendationIdentity,
    claimNonce: string,
    mediaId: string,
  ) => Promise<unknown>
  issueContext: (
    identity: RecommendationIdentity,
    mediaId: string,
    discovery: PlaybackDiscovery,
  ) => Promise<unknown>
  sendFacts: (variables: PlaybackFactsVariables) => Promise<unknown>
  invalidateIdentity: () => Promise<void>
  touch: () => void
  holdPlayback: () => () => void
  isForeground: () => boolean
  now?: () => number
  eventId?: (kind: string) => string
  wait?: (ms: number) => Promise<void>
  report?: (
    reason: string,
    disposition: "dropped" | "retrying",
    factCount: number,
  ) => void
}

export type RecommendationPlaybackRecorder = ReturnType<
  typeof createRecommendationPlaybackRecorder
>

const ACCEPTED_STATUSES = new Set(["accepted", "replay", "conflict"])
const MAX_PENDING_REGULAR_FACTS = MAX_PENDING_CLAIM_FACTS - 1
/** Optional observations may not crowd out attempt/start/active/terminal
 *  facts while the claim is still pending. */
const PENDING_OBSERVATION_CEILING = 8

function parseReceipts(value: unknown): PlaybackFactReceipt[] | null {
  if (!Array.isArray(value)) return null
  const receipts: PlaybackFactReceipt[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null
    const receipt = entry as Record<string, unknown>
    if (
      typeof receipt.eventId !== "string" ||
      typeof receipt.status !== "string" ||
      !ACCEPTED_STATUSES.has(receipt.status) ||
      typeof receipt.sequence !== "number"
    ) {
      return null
    }
    receipts.push({
      eventId: receipt.eventId,
      status: receipt.status,
      sequence: receipt.sequence,
    })
  }
  return receipts
}

export function createRecommendationPlaybackRecorder(
  deps: PlaybackRecorderDeps,
) {
  const now = deps.now ?? (() => Date.now())
  const eventId = deps.eventId ?? randomEventId
  const wait =
    deps.wait ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const report = deps.report ?? reportRecommendationPlaybackDegraded
  const iso = (ms: number) => new Date(ms).toISOString()

  let identity: RecommendationIdentity | null = null
  let episode: PlaybackEpisode | null = null
  /** Set once the claim can no longer succeed; the recorder is then inert. */
  let closed = false
  let terminal = false
  let disposed = false
  let releaseHold: (() => void) | null = null

  const pending: PlaybackFact[] = []
  let outbound: PlaybackFact[] = []
  const attempts = new Map<string, number>()
  let factCount = 0
  const kindCounts: Partial<Record<PlaybackFactKind, number>> = {}
  let observationsEnabled = true
  const counts = { seek: 0, navigation: 0, qoe: 0 }
  let draining = false
  let drainRequested = false
  let claimRateLimitDeferrals = 0
  let factRateLimitDeferrals = 0

  let attemptedAt: number | null = null
  let playbackStartedAt: number | null = null
  let lastProgressAt: number | null = null
  let activeStartedAt: number | null = null
  let playing = false
  let buffering = false
  let started = false
  let visible = deps.isForeground()
  let lastPosition = 0
  let lastDuration: number | null = null
  let lastTickAt: number | null = null
  let lastTickPosition: number | null = null

  function fact<T extends PlaybackFact>(
    value: Omit<T, "eventId" | "occurredAt">,
    at = now(),
  ): T {
    return {
      ...value,
      eventId: eventId(value.kind),
      occurredAt: iso(at),
    } as T
  }

  function release() {
    releaseHold?.()
    releaseHold = null
  }

  // ---- outbound queue -------------------------------------------------------

  function serialize(events: PlaybackFact[]): string {
    return JSON.stringify(
      buildPlaybackFactsVariables(identity!, episode!, deps.mediaId, events),
    )
  }

  function dropAll(reason: string) {
    const dropped = outbound.splice(0)
    for (const entry of dropped) attempts.delete(entry.eventId)
    if (dropped.length > 0) report(reason, "dropped", dropped.length)
  }

  async function drain(): Promise<void> {
    if (draining) {
      drainRequested = true
      return
    }
    draining = true
    try {
      while (outbound.length > 0 && episode && identity && !closed) {
        // Past `hardUntil` Admin rejects every fact for this episode; sending
        // them would only be a definitive failure with extra round trips.
        if (Date.parse(episode.hardUntil) <= now()) {
          dropAll("episode_expired")
          episode = null
          closed = true
          break
        }
        const batch = takeBatch(outbound, serialize)
        if (batch.oversized) {
          outbound = outbound.filter((entry) => entry !== batch.oversized)
          attempts.delete(batch.oversized.eventId)
          report("body_limit", "dropped", 1)
          continue
        }
        const events = batch.events
        if (events.length === 0) break
        for (const entry of events) {
          attempts.set(entry.eventId, (attempts.get(entry.eventId) ?? 0) + 1)
        }
        const maxAttempt = Math.max(
          ...events.map((entry) => attempts.get(entry.eventId) ?? 1),
        )
        let receiptInvalid = false
        try {
          const raw = await deps.sendFacts(
            buildPlaybackFactsVariables(
              identity,
              episode,
              deps.mediaId,
              events,
            ),
          )
          deps.touch()
          const receipts = parseReceipts(raw)
          if (!receipts) {
            receiptInvalid = true
            throw new RecommendationClientError("NETWORK_ERROR")
          }
          const retired = new Set(receipts.map((receipt) => receipt.eventId))
          const conflicts = receipts.filter((r) => r.status === "conflict")
          if (conflicts.length > 0) {
            report("integrity_conflict", "dropped", conflicts.length)
          }
          for (const id of retired) attempts.delete(id)
          outbound = outbound.filter((entry) => !retired.has(entry.eventId))
          const missing = events.filter((entry) => !retired.has(entry.eventId))
          if (missing.length > 0) {
            const exhausted = missing.filter(
              (entry) =>
                (attempts.get(entry.eventId) ?? 0) >=
                MAX_FACT_DELIVERY_ATTEMPTS,
            )
            if (exhausted.length > 0) {
              const ids = new Set(exhausted.map((entry) => entry.eventId))
              outbound = outbound.filter((entry) => !ids.has(entry.eventId))
              for (const id of ids) attempts.delete(id)
              report("receipt_missing", "dropped", exhausted.length)
            }
            const retrying = missing.length - exhausted.length
            if (retrying > 0) {
              report("receipt_missing", "retrying", retrying)
              await wait(FACT_RETRY_BACKOFF_MS * 2 ** (maxAttempt - 1))
            }
          }
        } catch (error) {
          const failure = toRecommendationClientError(error)
          if (
            failure.code === "BAD_USER_INPUT" &&
            events.some(isObservationFact)
          ) {
            // Admin rejects the whole batch on a schema miss. Optional
            // observations are the only facts whose shape can drift between
            // client and server; drop them and keep the baseline flowing.
            observationsEnabled = false
            const dropped = outbound.filter(isObservationFact)
            outbound = outbound.filter((entry) => !isObservationFact(entry))
            for (const entry of dropped) attempts.delete(entry.eventId)
            report("request_invalid", "dropped", dropped.length)
            continue
          }
          if (failure.definitive) {
            if (failure.code === "UNAUTHENTICATED") {
              await deps.invalidateIdentity()
            }
            dropAll(failure.code.toLowerCase())
            episode = null
            closed = true
            break
          }
          if (failure.code === "RATE_LIMITED") {
            // The limiter's answer is not a delivery attempt: the ladder keeps
            // its three real tries for after the window.
            for (const entry of events) {
              attempts.set(
                entry.eventId,
                (attempts.get(entry.eventId) ?? 1) - 1,
              )
            }
            if (factRateLimitDeferrals >= MAX_FACT_RATE_LIMIT_DEFERRALS) {
              const ids = new Set(events.map((entry) => entry.eventId))
              outbound = outbound.filter((entry) => !ids.has(entry.eventId))
              for (const id of ids) attempts.delete(id)
              report("rate_limited", "dropped", events.length)
              continue
            }
            factRateLimitDeferrals += 1
            report("rate_limited", "retrying", events.length)
            await wait(rateLimitDelayMs(failure))
            continue
          }
          const exhausted = events.filter(
            (entry) =>
              (attempts.get(entry.eventId) ?? 0) >= MAX_FACT_DELIVERY_ATTEMPTS,
          )
          if (exhausted.length > 0) {
            const ids = new Set(exhausted.map((entry) => entry.eventId))
            outbound = outbound.filter((entry) => !ids.has(entry.eventId))
            for (const id of ids) attempts.delete(id)
            report(
              receiptInvalid ? "receipt_invalid" : "transport_exhausted",
              "dropped",
              exhausted.length,
            )
          }
          const retrying = events.length - exhausted.length
          if (retrying > 0) {
            report(
              receiptInvalid ? "receipt_invalid" : "transport_retry",
              "retrying",
              retrying,
            )
            await wait(FACT_RETRY_BACKOFF_MS * 2 ** (maxAttempt - 1))
          }
        }
      }
    } finally {
      draining = false
      if (drainRequested && outbound.length > 0) {
        drainRequested = false
        void drain()
      }
    }
  }

  function enqueue(next: PlaybackFact, isTerminal = false) {
    if (closed) return
    if (terminal && !isTerminal) return
    if (isObservationFact(next) && !observationsEnabled) return
    if (next.kind === "playback_seek")
      counts.seek = Math.min(65535, counts.seek + 1)
    if (next.kind === "playback_navigation")
      counts.navigation = Math.min(65535, counts.navigation + 1)
    if (next.kind === "playback_qoe")
      counts.qoe = Math.min(65535, counts.qoe + 1)
    if (
      (next.kind === "playback_navigation" || next.kind === "playback_qoe") &&
      !episode &&
      pending.length >= PENDING_OBSERVATION_CEILING
    ) {
      report("pending_claim", "dropped", 1)
      return
    }
    const factLimit = isTerminal ? MAX_EPISODE_FACTS : MAX_EPISODE_FACTS - 1
    const kindCount = kindCounts[next.kind] ?? 0
    if (factCount >= factLimit || kindCount >= MAX_FACTS_BY_KIND[next.kind]) {
      report("episode_limit", "dropped", 1)
      return
    }
    if (!episode) {
      const limit = isTerminal
        ? MAX_PENDING_CLAIM_FACTS
        : MAX_PENDING_REGULAR_FACTS
      if (pending.length >= limit) {
        report("pending_claim", "dropped", 1)
        return
      }
      // Charged only once queued: a dropped fact must not spend a slot.
      factCount += 1
      kindCounts[next.kind] = kindCount + 1
      pending.push(next)
      return
    }
    factCount += 1
    kindCounts[next.kind] = kindCount + 1
    outbound.push(next)
    void drain()
  }

  // ---- claim --------------------------------------------------------------

  function abandon(reason = "claim_unavailable") {
    const dropped = pending.splice(0).length
    closed = true
    if (dropped > 0) report(reason, "dropped", dropped)
    release()
  }

  /**
   * `fallback` is the discovery mark held for a context fallback. It is set
   * on the selection-nonce path only, which is also the only path whose
   * nonce came from the pending store and can be put back.
   */
  async function attemptClaim(
    claimNonce: string,
    attempt: number,
    fallback: PlaybackDiscovery | null,
  ): Promise<void> {
    const abandonDisposed = () => {
      if (fallback) {
        // The store keeps this nonce's own selection time: the ten-minute
        // bound runs from the tap, not from the put-back.
        deps.restorePendingNonce({
          mediaId: deps.mediaId,
          claimNonce,
          selectedAt: now(),
        })
      }
      return abandon("disposed")
    }
    if (!identity || closed) return abandon()
    try {
      const claimed = parsePlaybackEpisode(
        await deps.claimEpisode(identity, claimNonce, deps.mediaId),
      )
      if (!claimed) throw new RecommendationClientError("BAD_USER_INPUT")
      // A claim that lands after dispose() still delivers the held facts
      // (attempt, route_exit) once; only the retry chain stops at dispose.
      episode = claimed
      deps.touch()
      outbound.push(...pending.splice(0))
      void drain()
    } catch (error) {
      const failure = toRecommendationClientError(error)
      if (failure.code === "UNAUTHENTICATED") {
        await deps.invalidateIdentity()
        return abandon()
      }
      if (failure.definitive) {
        // A definitive rejection kills the nonce, so no put-back: a stale or
        // foreign one still leaves an ordinary playback to attribute, but a
        // rejected context nonce does not.
        if (fallback && !disposed) return claimViaContext(1, fallback)
        return abandon(disposed ? "disposed" : undefined)
      }
      if (disposed) return abandonDisposed()
      if (failure.code === "RATE_LIMITED") {
        // Not a failed attempt: wait out the limiter's window, once.
        if (claimRateLimitDeferrals >= MAX_CLAIM_RATE_LIMIT_DEFERRALS) {
          return abandon("rate_limited")
        }
        claimRateLimitDeferrals += 1
        report("rate_limited", "retrying", pending.length)
        await wait(rateLimitDelayMs(failure))
        if (disposed) return abandonDisposed()
        return attemptClaim(claimNonce, attempt, fallback)
      }
      if (attempt < MAX_CLAIM_ATTEMPTS) {
        await wait(CLAIM_RETRY_BACKOFF_MS)
        if (disposed) return abandonDisposed()
        return attemptClaim(claimNonce, attempt + 1, fallback)
      }
      abandon()
    }
  }

  async function claimViaContext(
    attempt: number,
    discovery: PlaybackDiscovery,
  ): Promise<void> {
    if (!identity || closed) return abandon()
    try {
      const issued = await deps.issueContext(identity, deps.mediaId, discovery)
      const claimNonce =
        issued && typeof issued === "object"
          ? (issued as { claimNonce?: unknown }).claimNonce
          : issued
      if (
        typeof claimNonce !== "string" ||
        claimNonce.length < 16 ||
        claimNonce.length > 191
      ) {
        throw new RecommendationClientError("BAD_USER_INPUT")
      }
      // Issuance is part of the claim (plan KD7): one attempt budget and one
      // window deferral cover both steps, and a context that settles after
      // dispose() still claims once, like a nonce claim in flight.
      return attemptClaim(claimNonce, attempt, null)
    } catch (error) {
      const failure = toRecommendationClientError(error)
      if (failure.code === "UNAUTHENTICATED") {
        await deps.invalidateIdentity()
        return abandon()
      }
      if (disposed) return abandon("disposed")
      if (failure.definitive) return abandon()
      if (failure.code === "RATE_LIMITED") {
        if (claimRateLimitDeferrals >= MAX_CLAIM_RATE_LIMIT_DEFERRALS) {
          return abandon("rate_limited")
        }
        claimRateLimitDeferrals += 1
        report("rate_limited", "retrying", pending.length)
        await wait(rateLimitDelayMs(failure))
        if (disposed) return abandon("disposed")
        return claimViaContext(attempt, discovery)
      }
      if (attempt < MAX_CLAIM_ATTEMPTS) {
        await wait(CLAIM_RETRY_BACKOFF_MS)
        if (disposed) return abandon("disposed")
        return claimViaContext(attempt + 1, discovery)
      }
      abandon()
    }
  }

  async function resolveClaim(): Promise<void> {
    const result = await deps.getIdentity()
    if (result.kind !== "ready") return abandon()
    // Same rule as the discovery mark: leave the selection nonce for the
    // recorder that will actually attribute this media.
    if (disposed) return abandon("disposed")
    identity = result.identity
    const nonce = deps.takePendingNonce(deps.mediaId)
    // Taken once, on both paths: a mark left behind would label the next
    // open of this media, which the viewer reached some other way.
    const discovery = deps.takeDiscovery(deps.discoveryKeys)
    if (nonce) return attemptClaim(nonce, 1, discovery)
    return claimViaContext(1, discovery)
  }

  // ---- playback state -------------------------------------------------------

  function recordAttempt() {
    if (attemptedAt != null) return
    attemptedAt = now()
    enqueue(
      fact<Extract<PlaybackFact, { kind: "playback_attempt" }>>(
        { kind: "playback_attempt", payload: { initiation: "manual" } },
        attemptedAt,
      ),
    )
  }

  function startActive() {
    if (terminal || activeStartedAt != null || !playing || !visible) return
    activeStartedAt = now()
  }

  function flushActive() {
    const startedAt = activeStartedAt
    activeStartedAt = null
    if (startedAt == null) return
    let remaining = Math.max(0, now() - startedAt)
    let emitted = 0
    while (remaining > 0) {
      const chunk = Math.min(MAX_ACTIVE_CHUNK_MS, remaining)
      enqueue(
        fact<
          Extract<PlaybackFact, { kind: "playback_active_visible_playing" }>
        >(
          {
            kind: "playback_active_visible_playing",
            payload: {
              activeMilliseconds: Math.round(chunk),
              coverage: "complete",
            },
          },
          startedAt + emitted + chunk,
        ),
      )
      emitted += chunk
      remaining -= chunk
    }
    if (playing && visible) activeStartedAt = now()
  }

  function navigation(action: PlaybackNavigationAction, position: number) {
    if (terminal) return
    recordAttempt()
    enqueue(
      fact<Extract<PlaybackFact, { kind: "playback_navigation" }>>({
        kind: "playback_navigation",
        payload: { action, cause: "unknown", positionSeconds: position },
      }),
    )
  }

  function qoe(action: PlaybackQoeAction, position: number) {
    if (terminal || attemptedAt == null) return
    enqueue(
      fact<Extract<PlaybackFact, { kind: "playback_qoe" }>>({
        kind: "playback_qoe",
        payload: { action, cause: "unknown", positionSeconds: position },
      }),
    )
  }

  function recordObservation(errorObserved: boolean) {
    enqueue(
      fact<Extract<PlaybackFact, { kind: "playback_observation" }>>({
        kind: "playback_observation",
        payload: {
          version: "playback-observations-v1",
          elapsedMilliseconds: boundedWallMs(now() - (attemptedAt ?? now())),
          visibility: visible ? "visible" : "hidden",
          playerState: buffering ? "buffering" : playing ? "playing" : "paused",
          startObserved: started,
          errorObserved,
          seekCount: counts.seek,
          navigationCount: counts.navigation,
          qoeCount: counts.qoe,
        },
      }),
    )
  }

  function position(value?: number): number {
    if (value != null) lastPosition = boundedPosition(value)
    return lastPosition
  }

  function onEnd(
    reason: "ended" | "route_exit",
    positionSeconds?: number,
    durationSeconds?: number,
  ): void {
    if (terminal) return
    recordAttempt()
    const at = position(positionSeconds)
    const duration = durationSeconds ?? lastDuration
    playing = false
    flushActive()
    recordObservation(false)
    terminal = true
    enqueue(
      fact<Extract<PlaybackFact, { kind: "playback_end" }>>({
        kind: "playback_end",
        payload: {
          reason,
          ...playbackPosition(at, duration),
          completed: reason === "ended",
        },
      }),
      true,
    )
    release()
  }

  return {
    /** Begin the episode: hold the session, record the attempt, claim. */
    start(): void {
      if (attemptedAt != null || closed) return
      releaseHold = deps.holdPlayback()
      recordAttempt()
      void resolveClaim()
    },

    onPlayingChange(isPlaying: boolean, positionSeconds?: number): void {
      if (terminal) return
      const at = position(positionSeconds)
      if (isPlaying) {
        recordAttempt()
        if (buffering) {
          qoe("buffering_end", at)
          buffering = false
        } else if (started && !playing) {
          navigation("resume", at)
        }
        playing = true
        lastTickAt = null
        lastTickPosition = null
        if (!started) {
          started = true
          playbackStartedAt = now()
          lastProgressAt = playbackStartedAt
          enqueue(
            fact<Extract<PlaybackFact, { kind: "playback_start" }>>({
              kind: "playback_start",
              payload: { positionSeconds: at },
            }),
          )
        }
        startActive()
        return
      }
      if (playing || buffering) navigation("pause", at)
      if (buffering) qoe("buffering_end", at)
      buffering = false
      playing = false
      lastTickAt = null
      lastTickPosition = null
      flushActive()
    },

    /** One tick of the adapter's 1 s poll, playing only. */
    onTick(positionSeconds: number, durationSeconds: number): void {
      if (terminal) return
      const at = now()
      const current = position(positionSeconds)
      lastDuration = durationSeconds
      if (started && lastTickAt != null && lastTickPosition != null) {
        const expected = lastTickPosition + (at - lastTickAt) / 1_000
        if (Math.abs(current - expected) > SEEK_JUMP_THRESHOLD_S) {
          enqueue(
            fact<Extract<PlaybackFact, { kind: "playback_seek" }>>({
              kind: "playback_seek",
              payload: { fromSeconds: lastTickPosition, toSeconds: current },
            }),
          )
        }
      }
      lastTickAt = at
      lastTickPosition = current
      if (
        playbackStartedAt == null ||
        lastProgressAt == null ||
        at - lastProgressAt < PROGRESS_INTERVAL_MS
      ) {
        return
      }
      lastProgressAt = at
      if (
        activeStartedAt != null &&
        at - activeStartedAt >= MAX_ACTIVE_CHUNK_MS
      )
        flushActive()
      enqueue(
        fact<Extract<PlaybackFact, { kind: "playback_progress" }>>({
          kind: "playback_progress",
          payload: {
            ...playbackPosition(current, durationSeconds),
            wallElapsedMilliseconds: boundedWallMs(at - playbackStartedAt),
          },
        }),
      )
    },

    onBuffering(action: "waiting" | "stalled", positionSeconds?: number): void {
      if (terminal || buffering || attemptedAt == null) return
      const at = position(positionSeconds)
      buffering = true
      qoe(action, at)
      playing = false
      lastTickAt = null
      lastTickPosition = null
      flushActive()
    },

    /** The player is ready again; `isPlaying` says whether it resumed. */
    onBufferingEnd(isPlaying: boolean, positionSeconds?: number): void {
      if (terminal || !buffering) return
      const at = position(positionSeconds)
      buffering = false
      qoe("buffering_end", at)
      if (isPlaying) {
        playing = true
        startActive()
      }
    },

    /** Foreground/background: the device's visibility axis. */
    onVisibility(isVisible: boolean, positionSeconds?: number): void {
      if (isVisible === visible) return
      visible = isVisible
      if (terminal) return
      const at = position(positionSeconds)
      navigation(isVisible ? "visible" : "hidden", at)
      if (isVisible) startActive()
      else flushActive()
    },

    onError(positionSeconds?: number): void {
      if (terminal) return
      recordAttempt()
      const at = position(positionSeconds)
      playing = false
      flushActive()
      recordObservation(true)
      terminal = true
      enqueue(
        fact<Extract<PlaybackFact, { kind: "playback_error" }>>({
          kind: "playback_error",
          payload: { code: "media_error", positionSeconds: at },
        }),
        true,
      )
      release()
    },

    onEnd,

    /** Teardown: an un-ended session is a route exit. Idempotent. */
    dispose(): void {
      if (disposed) return
      disposed = true
      if (!terminal && !closed) onEnd("route_exit")
      release()
    },

    /** Inspection for tests and diagnostics; never logged. */
    getState() {
      return {
        claimed: episode != null,
        closed,
        terminal,
        pendingCount: pending.length,
        outboundCount: outbound.length,
        factCount,
        observationsEnabled,
      }
    },
  }
}

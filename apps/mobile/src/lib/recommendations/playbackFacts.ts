/**
 * Strict playback facts (feat-516): the event shapes Admin's
 * `RecommendationPlaybackEventSchema` accepts, the caps Web's recorder
 * applies, and the batch builder. Pure; the recorder decides WHEN each fact
 * is made, this module decides WHAT it looks like on the wire.
 */
import { RECOMMENDATION_EVIDENCE_CONTRACT } from "./operations"
import type { RecommendationIdentity } from "./viewerIdentity"

/** Admin's per-batch bound, and Web's serialized-body bound. */
export const PLAYBACK_EVENT_LIMIT = 16
export const PLAYBACK_BODY_BYTES = 8 * 1024
/** Web's per-episode caps: one attempt, one start, one terminal, ... */
export const MAX_EPISODE_FACTS = 128
export const MAX_PENDING_CLAIM_FACTS = 16
export const MAX_FACT_DELIVERY_ATTEMPTS = 3
export const FACT_RETRY_BACKOFF_MS = 100
export const MAX_CLAIM_ATTEMPTS = 3
export const CLAIM_RETRY_BACKOFF_MS = 250
/** A rate-limited answer defers instead of counting as an attempt, this often. */
export const MAX_CLAIM_RATE_LIMIT_DEFERRALS = 1
export const MAX_FACT_RATE_LIMIT_DEFERRALS = 3
export const PROGRESS_INTERVAL_MS = 10_000
export const MAX_ACTIVE_CHUNK_MS = 60_000
/** A tick that lands this far off the expected playhead is a seek. */
export const SEEK_JUMP_THRESHOLD_S = 2
const MAX_SECONDS = 86_400
const MAX_WALL_MS = 6 * 60 * 60 * 1_000

export type PlaybackPosition = {
  positionSeconds: number
  durationSeconds: number | null
  progress: number | null
}

export type PlaybackEndReason = "ended" | "route_exit" | "pagehide" | "hidden"
export type PlaybackNavigationAction =
  | "pause"
  | "resume"
  | "hidden"
  | "visible"
  | "bfcache_suspend"
  | "bfcache_resume"
export type PlaybackQoeAction = "waiting" | "stalled" | "buffering_end"

export type PlaybackFact =
  | {
      eventId: string
      kind: "playback_attempt"
      occurredAt: string
      payload: { initiation: "manual" | "automatic" }
    }
  | {
      eventId: string
      kind: "playback_start"
      occurredAt: string
      payload: { positionSeconds: number }
    }
  | {
      eventId: string
      kind: "playback_progress"
      occurredAt: string
      payload: PlaybackPosition & { wallElapsedMilliseconds: number }
    }
  | {
      eventId: string
      kind: "playback_seek"
      occurredAt: string
      payload: { fromSeconds: number; toSeconds: number }
    }
  | {
      eventId: string
      kind: "playback_active_visible_playing"
      occurredAt: string
      payload: { activeMilliseconds: number; coverage: "complete" }
    }
  | {
      eventId: string
      kind: "playback_observation"
      occurredAt: string
      payload: {
        version: "playback-observations-v1"
        elapsedMilliseconds: number
        visibility: "visible" | "hidden" | "unknown"
        playerState: "playing" | "paused" | "buffering" | "unknown"
        startObserved: boolean
        errorObserved: boolean
        seekCount: number
        navigationCount: number
        qoeCount: number
      }
    }
  | {
      eventId: string
      kind: "playback_navigation"
      occurredAt: string
      payload: {
        action: PlaybackNavigationAction
        cause: "unknown"
        positionSeconds: number
      }
    }
  | {
      eventId: string
      kind: "playback_qoe"
      occurredAt: string
      payload: {
        action: PlaybackQoeAction
        cause: "unknown"
        positionSeconds: number
      }
    }
  | {
      eventId: string
      kind: "playback_end"
      occurredAt: string
      payload: PlaybackPosition & {
        reason: PlaybackEndReason
        completed: boolean
      }
    }
  | {
      eventId: string
      kind: "playback_error"
      occurredAt: string
      payload: { code: string; positionSeconds: number }
    }

export type PlaybackFactKind = PlaybackFact["kind"]

export const MAX_FACTS_BY_KIND: Readonly<Record<PlaybackFactKind, number>> = {
  playback_attempt: 1,
  playback_start: 1,
  playback_progress: 64,
  playback_seek: 32,
  playback_observation: 1,
  playback_navigation: 16,
  playback_qoe: 16,
  playback_active_visible_playing: 64,
  playback_end: 1,
  playback_error: 1,
}

export const TERMINAL_FACT_KINDS: ReadonlySet<PlaybackFactKind> = new Set([
  "playback_end",
  "playback_error",
])

/** Optional observations Admin may reject as a whole batch; droppable. */
export const OBSERVATION_FACT_KINDS: ReadonlySet<PlaybackFactKind> = new Set([
  "playback_observation",
  "playback_navigation",
  "playback_qoe",
])

export function isObservationFact(fact: PlaybackFact): boolean {
  return OBSERVATION_FACT_KINDS.has(fact.kind)
}

export function boundedPosition(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  return Math.min(MAX_SECONDS, Math.max(0, value))
}

export function boundedDuration(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null
  }
  return Math.min(MAX_SECONDS, value)
}

export function boundedWallMs(value: number): number {
  return Math.min(MAX_WALL_MS, Math.max(0, Math.round(value)))
}

export function playbackPosition(
  position: unknown,
  duration: unknown,
): PlaybackPosition {
  const positionSeconds = boundedPosition(position)
  const durationSeconds = boundedDuration(duration)
  return {
    positionSeconds,
    durationSeconds,
    progress:
      durationSeconds == null
        ? null
        : Math.min(1, Math.max(0, positionSeconds / durationSeconds)),
  }
}

export type PlaybackEpisode = {
  episodeId: string
  capability: string
  activeUntil: string
  hardUntil: string
}

/** Admin's episode claim, checked field by field before it is trusted. */
export function parsePlaybackEpisode(value: unknown): PlaybackEpisode | null {
  if (!value || typeof value !== "object") return null
  const episode = value as Record<string, unknown>
  const activeUntil =
    typeof episode.activeUntil === "string"
      ? Date.parse(episode.activeUntil)
      : Number.NaN
  const hardUntil =
    typeof episode.hardUntil === "string"
      ? Date.parse(episode.hardUntil)
      : Number.NaN
  if (
    typeof episode.episodeId !== "string" ||
    episode.episodeId.length < 1 ||
    episode.episodeId.length > 191 ||
    typeof episode.capability !== "string" ||
    episode.capability.length < 1 ||
    episode.capability.length > 4096 ||
    !Number.isFinite(activeUntil) ||
    !Number.isFinite(hardUntil) ||
    hardUntil < activeUntil
  ) {
    return null
  }
  return {
    episodeId: episode.episodeId,
    capability: episode.capability,
    activeUntil: episode.activeUntil as string,
    hardUntil: episode.hardUntil as string,
  }
}

export type PlaybackFactsVariables = {
  contractVersion: string
  capability: string
  episodeId: string
  viewerToken: string
  sessionToken: string
  mediaId: string
  events: PlaybackFact[]
}

export function buildPlaybackFactsVariables(
  identity: RecommendationIdentity,
  episode: Pick<PlaybackEpisode, "episodeId" | "capability">,
  mediaId: string,
  events: PlaybackFact[],
): PlaybackFactsVariables {
  return {
    contractVersion: RECOMMENDATION_EVIDENCE_CONTRACT,
    capability: episode.capability,
    episodeId: episode.episodeId,
    viewerToken: identity.viewerToken,
    sessionToken: identity.sessionToken,
    mediaId,
    events,
  }
}

/** UTF-8 byte length without TextEncoder (absent on some Hermes builds). */
export function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      // A surrogate pair is one 4-byte code point.
      bytes += 4
      i += 1
    } else bytes += 3
  }
  return bytes
}

/**
 * The longest prefix of `queue` that fits one batch: at most 16 facts and
 * at most 8 KB serialized. A single fact that cannot fit alone is returned as
 * `oversized` so the caller can drop it rather than stall the queue.
 */
export function takeBatch(
  queue: readonly PlaybackFact[],
  serialize: (events: PlaybackFact[]) => string,
): { events: PlaybackFact[]; oversized: PlaybackFact | null } {
  const events: PlaybackFact[] = []
  while (events.length < queue.length && events.length < PLAYBACK_EVENT_LIMIT) {
    const candidate = queue[events.length]!
    const body = serialize([...events, candidate])
    if (utf8ByteLength(body) > PLAYBACK_BODY_BYTES) {
      if (events.length === 0) return { events, oversized: candidate }
      break
    }
    events.push(candidate)
  }
  return { events, oversized: null }
}

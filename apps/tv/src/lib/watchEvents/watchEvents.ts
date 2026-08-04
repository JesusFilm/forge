// Anonymous watch-event capture for TV — mirrors apps/web's WatchEventRecorder
// semantics (same meaningful thresholds, same queue cap, compatible event
// shape) so queued events can flush into admin's `recordWatchEvent` mutation
// once feat-322 device-grant sign-in exists. TV is fully anonymous today, so
// EVERY meaningful event queues locally; nothing leaves the device until a
// signed-in flush is wired to `flushWatchEventQueue`.
//
// Decision logic is pure and React-free (repo convention: apps/tv has no
// render harness — same rationale as actionRowScrollGlide.ts); storage I/O
// goes through safeStorage (AsyncStorage with in-memory fallback, the
// watchPreferences pattern) and is best-effort only.

import { getStorage } from "../safeStorage"

// Thresholds and cap mirror apps/web/src/components/watch/WatchEventRecorder.tsx.
export const MEANINGFUL_SECONDS = 30
export const MEANINGFUL_PROGRESS = 0.25
export const MAX_QUEUED_EVENTS = 8

export const VIEWER_ID_STORAGE_KEY = "forge.watch.viewer_id"
export const QUEUE_STORAGE_KEY = "forge.watch.pending_events"

/** Identity of what is playing, threaded from the screen that opened the
 *  player (VideoPlayerContext carries it; the player itself stays URL-only). */
export type WatchEventIdentity = {
  /** Admin Video documentId. */
  videoId: string
  /** Admin VideoDub documentId, when a dub was selected. */
  videoDubId: string | null
}

export type PlaybackSnapshot = {
  positionSeconds: number
  durationSeconds: number | null
}

/** Shape stored in AsyncStorage; matches admin's `recordWatchEvent` variables
 *  (progress is 0..1 like web's; `queuedAt` becomes `occurredAt` at flush). */
export type QueuedWatchEvent = WatchEventIdentity & {
  positionSeconds: number | null
  durationSeconds: number | null
  progress: number | null
  requestSessionId: string
  queuedAt: string
}

// ── Pure decision layer ─────────────────────────────────────────────────────

export type MeaningfulState = {
  /** Latch: one meaningful event per player mount / source. */
  recorded: boolean
}

export const initialMeaningfulState: MeaningfulState = { recorded: false }

/**
 * One timeUpdate tick. Returns the next latch state and whether THIS tick
 * crossed the meaningful threshold (30s watched OR 25% progress — whichever
 * comes first, same as web).
 */
export function evaluateMeaningfulPlayback(
  state: MeaningfulState,
  currentTimeSeconds: number,
  durationSeconds: number | null,
): { state: MeaningfulState; record: boolean } {
  if (state.recorded) return { state, record: false }
  const progress =
    durationSeconds != null && durationSeconds > 0
      ? currentTimeSeconds / durationSeconds
      : 0
  const meaningful =
    currentTimeSeconds >= MEANINGFUL_SECONDS || progress >= MEANINGFUL_PROGRESS
  if (!meaningful) return { state, record: false }
  return { state: { recorded: true }, record: true }
}

/** Build the storable event from identity + a playback snapshot. */
export function buildQueuedWatchEvent(
  identity: WatchEventIdentity,
  snapshot: PlaybackSnapshot,
  requestSessionId: string,
  queuedAt: string,
): QueuedWatchEvent {
  const duration =
    snapshot.durationSeconds != null &&
    Number.isFinite(snapshot.durationSeconds) &&
    snapshot.durationSeconds > 0
      ? snapshot.durationSeconds
      : null
  const position = Number.isFinite(snapshot.positionSeconds)
    ? snapshot.positionSeconds
    : null
  return {
    videoId: identity.videoId,
    videoDubId: identity.videoDubId,
    positionSeconds: position,
    durationSeconds: duration,
    progress: duration != null && position != null ? position / duration : null,
    requestSessionId,
    queuedAt,
  }
}

/** Cap-preserving append: keeps the NEWEST events, like web's slice(-MAX). */
export function appendCapped(
  queue: readonly QueuedWatchEvent[],
  event: QueuedWatchEvent,
): QueuedWatchEvent[] {
  return [...queue, event].slice(-MAX_QUEUED_EVENTS)
}

/** Parse a raw storage payload defensively; anything malformed is dropped. */
export function parseQueue(raw: string | null): QueuedWatchEvent[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (e): e is QueuedWatchEvent =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as { videoId?: unknown }).videoId === "string" &&
          typeof (e as { requestSessionId?: unknown }).requestSessionId ===
            "string" &&
          typeof (e as { queuedAt?: unknown }).queuedAt === "string",
      )
      .slice(0, MAX_QUEUED_EVENTS)
  } catch {
    return []
  }
}

/** RFC 4122 v4 shape. Hermes has no crypto.randomUUID; Math.random is fine for
 *  an anonymous device id (no security property rides on it). */
export function generateViewerId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID()
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16)
    const v = c === "x" ? r : (r % 4) + 8
    return v.toString(16)
  })
}

// ── AsyncStorage layer (best-effort; failures never break playback) ─────────

/** Stable anonymous viewer id, minted once per install. */
export async function getViewerId(): Promise<string> {
  const storage = getStorage()
  try {
    const stored = await storage.getItem(VIEWER_ID_STORAGE_KEY)
    if (stored) return stored
    const fresh = generateViewerId()
    await storage.setItem(VIEWER_ID_STORAGE_KEY, fresh)
    return fresh
  } catch {
    // Storage unavailable — a per-session id still groups this run's events.
    return generateViewerId()
  }
}

export async function readWatchEventQueue(): Promise<QueuedWatchEvent[]> {
  try {
    return parseQueue(await getStorage().getItem(QUEUE_STORAGE_KEY))
  } catch {
    return []
  }
}

async function writeWatchEventQueue(
  events: readonly QueuedWatchEvent[],
): Promise<void> {
  const storage = getStorage()
  try {
    if (events.length === 0) {
      await storage.removeItem(QUEUE_STORAGE_KEY)
      return
    }
    await storage.setItem(
      QUEUE_STORAGE_KEY,
      JSON.stringify(events.slice(-MAX_QUEUED_EVENTS)),
    )
  } catch {
    // Best-effort only.
  }
}

/** Queue one meaningful-playback event. Fire-and-forget from the player path —
 *  never throws. */
export async function queueMeaningfulWatchEvent(
  identity: WatchEventIdentity,
  snapshot: PlaybackSnapshot,
): Promise<void> {
  try {
    const viewerId = await getViewerId()
    const event = buildQueuedWatchEvent(
      identity,
      snapshot,
      viewerId,
      new Date().toISOString(),
    )
    await writeWatchEventQueue(appendCapped(await readWatchEventQueue(), event))
  } catch {
    // Best-effort only.
  }
}

/**
 * Drain the queue through `submit` (one event at a time, oldest first).
 * Events whose submit rejects or resolves false are RETAINED for a later
 * flush. Intended caller: the feat-322 sign-in success path, submitting to
 * admin's `recordWatchEvent` with `occurredAt: event.queuedAt`. Not wired yet
 * — TV has no authenticated session until the device-grant work lands.
 */
export async function flushWatchEventQueue(
  submit: (event: QueuedWatchEvent) => Promise<boolean>,
): Promise<{ submitted: number; retained: number }> {
  const queue = await readWatchEventQueue()
  if (queue.length === 0) return { submitted: 0, retained: 0 }
  const retained: QueuedWatchEvent[] = []
  let submitted = 0
  for (const event of queue) {
    try {
      if (await submit(event)) {
        submitted += 1
      } else {
        retained.push(event)
      }
    } catch {
      retained.push(event)
    }
  }
  await writeWatchEventQueue(retained)
  return { submitted, retained: retained.length }
}

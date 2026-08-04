/**
 * Progress recorder (KTD5): receives (identity, position, duration) ticks
 * from the player adapter's 1-second poll, samples at web's 2-second
 * granularity into buffered intents, and requests a drain after every
 * sample — the sync cadence (one send per 30s, forced on pause/background/
 * unmount/end) is what turns those requests into actual mutations.
 *
 * No-ops without an identity (the hero surfaces never pass one) and drops
 * signed-out ticks at this boundary (R10). Offline playback routes writes
 * to the account-bound queue instead of the network buffer (R7).
 */

import type { ProgressWriteIntent, WatchProgressEntry } from "./store"
import { isCompleted, progressRatio } from "./thresholds"

export const SAMPLE_INTERVAL_MS = 2_000

export type ProgressIdentity = {
  videoId?: string
  /** Offline playback's only on-device key (the downloads manifest stores
   *  slugs); admin resolves it server-side (KTD8). */
  videoSlug?: string
  languageSlug?: string | null
}

export type RecorderSourceKind = "network" | "offline"

export type FlushTrigger = "pause" | "background" | "unmount" | "end"

export type RecorderDeps = {
  getAccountId: () => string | null
  /** Network path: buffer for the 30s batch sender. */
  bufferIntent: (intent: ProgressWriteIntent) => void
  /** Offline path: persist into the account-bound queue. */
  enqueueOffline: (accountId: string, write: ProgressWriteIntent) => void
  /** Ask the sync layer to drain (it applies the cadence gate). */
  requestDrain: (options: { forced: boolean }) => void
  /** Local echo so bars update immediately (id-keyed entries only). */
  applyLocal: (accountId: string, entry: WatchProgressEntry) => void
  now?: () => number
}

export type ProgressRecorder = ReturnType<typeof createProgressRecorder>

export function createProgressRecorder(
  identity: ProgressIdentity | null,
  sourceKind: RecorderSourceKind,
  deps: RecorderDeps,
) {
  const now = deps.now ?? (() => Date.now())
  let lastSampleAt: number | null = null
  let lastObserved: { position: number; duration: number } | null = null

  function record(position: number, duration: number): boolean {
    if (!identity) return false
    const accountId = deps.getAccountId()
    if (accountId == null) return false
    if (!Number.isFinite(position) || !Number.isFinite(duration)) return false
    if (duration <= 0) return false
    const clamped = Math.min(Math.max(0, position), duration)
    const recordedAt = new Date(now()).toISOString()
    const intent: ProgressWriteIntent = {
      // One identity key per intent: the id when known, else the slug.
      videoId: identity.videoId,
      videoSlug: identity.videoId ? undefined : identity.videoSlug,
      languageSlug: identity.languageSlug ?? null,
      positionSeconds: clamped,
      durationSeconds: duration,
      recordedAt,
    }
    if (!intent.videoId && !intent.videoSlug) return false
    if (sourceKind === "offline") {
      deps.enqueueOffline(accountId, intent)
    } else {
      deps.bufferIntent(intent)
    }
    if (identity.videoId) {
      deps.applyLocal(accountId, {
        videoId: identity.videoId,
        languageSlug: identity.languageSlug ?? null,
        positionSeconds: clamped,
        durationSeconds: duration,
        completed: isCompleted(progressRatio(clamped, duration)),
        updatedAt: recordedAt,
      })
    }
    return true
  }

  return {
    /** One tick from the adapter's 1-second poll (playing only). */
    onTick(position: number, duration: number) {
      lastObserved = { position, duration }
      if (!identity) return
      const timeNow = now()
      if (lastSampleAt != null && timeNow - lastSampleAt < SAMPLE_INTERVAL_MS) {
        return
      }
      lastSampleAt = timeNow
      if (record(position, duration)) {
        deps.requestDrain({ forced: false })
      }
    },

    /**
     * Forced write: pause, background, unmount, and playback end each
     * record the latest observed position immediately (KTD5). Playback end
     * records the completed range (position = duration).
     */
    flush(trigger: FlushTrigger) {
      if (!identity || lastObserved == null) return
      const position =
        trigger === "end" ? lastObserved.duration : lastObserved.position
      if (record(position, lastObserved.duration)) {
        deps.requestDrain({ forced: true })
      }
    },
  }
}

/**
 * Fail-open read planning + batch cadence (KTD5, KTD8, R11).
 *
 * Reads follow the topUpFetch last-good pattern: a failed hydration reuses
 * the last good entries so a transient blip never blanks bars; an empty
 * SUCCESS renders empty (a cleared account is real data) but never clobbers
 * the last-good cache.
 *
 * Writes follow KTD5's rate-limit budget: admin allows 30 mutations/min per
 * user, so buffered intents emit at most one batched send every 30 seconds,
 * with pause/background/unmount/end forcing an immediate send.
 */

import type { WatchProgressEntry } from "./store"

export const PROGRESS_BATCH_INTERVAL_MS = 30_000

export type ProgressReadOutcome =
  | { ok: true; entries: readonly WatchProgressEntry[] }
  | { ok: false }

export function resolveProgressEntries(
  outcome: ProgressReadOutcome,
  lastGood: readonly WatchProgressEntry[] | null,
): {
  entries: readonly WatchProgressEntry[]
  nextLastGood: readonly WatchProgressEntry[] | null
} {
  if (outcome.ok) {
    return {
      entries: outcome.entries,
      nextLastGood: outcome.entries.length > 0 ? outcome.entries : lastGood,
    }
  }
  return { entries: lastGood ?? [], nextLastGood: lastGood }
}

export type BatchCadenceState = {
  /** Epoch ms of the last send, or null before the first. */
  lastSentAt: number | null
}

export type BatchSendPlan = {
  send: boolean
  nextState: BatchCadenceState
}

/**
 * At most one send per 30-second window; a forced trigger (pause,
 * background, unmount, playback end) sends immediately and resets the
 * window. `hasIntents: false` never sends.
 */
export function planBatchSend({
  state,
  now,
  forced,
  hasIntents,
}: {
  state: BatchCadenceState
  now: number
  forced: boolean
  hasIntents: boolean
}): BatchSendPlan {
  if (!hasIntents) return { send: false, nextState: state }
  if (
    forced ||
    state.lastSentAt == null ||
    now - state.lastSentAt >= PROGRESS_BATCH_INTERVAL_MS
  ) {
    return { send: true, nextState: { lastSentAt: now } }
  }
  return { send: false, nextState: state }
}

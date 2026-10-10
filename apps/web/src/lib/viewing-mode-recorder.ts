export type ViewingModeInterval = {
  version: "sound-off-viewing-v1"
  mode: "sound_off" | "sound_on"
  preview: boolean
  activeMilliseconds: number
  fromSeconds: number
  toSeconds: number
  durationSeconds: number | null
  playbackRate: number
}

export type ViewingModeSnapshot = {
  positionSeconds: number
  durationSeconds: number | null
  playing: boolean
  visible: boolean | null
  mode: ViewingModeInterval["mode"] | null
  preview: boolean
  playbackRate: number
}

const MAX_SAMPLE_GAP_MS = 5_000
const FLUSH_INTERVAL_MS = 10_000

/** Bounded foreground media-progress evidence, independent of play activation. */
export function createViewingModeRecorder(input: {
  read: () => ViewingModeSnapshot
  now: () => number
  emit: (interval: ViewingModeInterval, endedAt: number) => void
}) {
  let previous: { state: ViewingModeSnapshot; at: number } | null = null
  let pending: ViewingModeInterval | null = null
  let pendingEndedAt = 0

  const flush = () => {
    if (pending != null && pending.activeMilliseconds >= 1)
      input.emit(pending, pendingEndedAt)
    pending = null
  }

  const sample = () => {
    const state = input.read()
    const at = input.now()
    const prior = previous
    previous = { state, at }
    if (!prior) return
    const elapsed = Math.floor(at - prior.at)
    const before = prior.state
    const advanced = state.positionSeconds - before.positionSeconds
    const valid =
      before.playing &&
      before.visible === true &&
      before.mode != null &&
      Number.isFinite(before.positionSeconds) &&
      before.positionSeconds >= 0 &&
      Number.isFinite(state.positionSeconds) &&
      state.positionSeconds <= 86_400 &&
      Number.isFinite(before.playbackRate) &&
      before.playbackRate >= 0.25 &&
      before.playbackRate <= 4 &&
      elapsed > 0 &&
      elapsed <= MAX_SAMPLE_GAP_MS &&
      advanced > 0 &&
      advanced <= (elapsed / 1_000) * before.playbackRate + 0.5
    if (!valid) {
      flush()
      return
    }

    // A stalled decoder or throttled event loop cannot create wall-clock watch
    // time without corresponding media progress. Seeks and loop jumps split it.
    const activeMilliseconds = Math.min(
      elapsed,
      Math.floor((advanced / before.playbackRate) * 1_000),
    )
    if (activeMilliseconds < 1) {
      flush()
      return
    }
    if (
      pending &&
      (pending.mode !== before.mode ||
        pending.preview !== before.preview ||
        pending.playbackRate !== before.playbackRate ||
        Math.abs(pending.toSeconds - before.positionSeconds) > 0.5)
    )
      flush()
    if (pending) {
      pending.activeMilliseconds += activeMilliseconds
      pending.toSeconds = state.positionSeconds
    } else {
      pending = {
        version: "sound-off-viewing-v1",
        mode: before.mode!,
        preview: before.preview,
        activeMilliseconds,
        fromSeconds: before.positionSeconds,
        toSeconds: state.positionSeconds,
        durationSeconds: before.durationSeconds,
        playbackRate: before.playbackRate,
      }
    }
    pendingEndedAt = at
    if (
      pending.activeMilliseconds >= FLUSH_INTERVAL_MS ||
      !state.playing ||
      state.visible !== true ||
      state.mode !== before.mode ||
      state.preview !== before.preview ||
      state.playbackRate !== before.playbackRate
    )
      flush()
  }

  return {
    sample,
    flush: () => {
      sample()
      flush()
    },
  }
}

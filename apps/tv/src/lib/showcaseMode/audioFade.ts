// Pure audio-fade curve + arming rule for ReelPlayer (R10/R11). React-free and
// colocated so the ramp is unit-testable — apps/tv has no render harness by
// convention (see reelPlayerGate.ts, the pattern this mirrors).

import type { ExcerptWindow } from "./types"

/** Mirrors POSTER_FADE_MS, so the audio arrives exactly as the picture is revealed. */
export const AUDIO_FADE_IN_MS = 500

/**
 * The fade-out occupies the excerpt's last second and must LAND on silence at the
 * window end, never ramp past it: playing on would reach the final seconds R6
 * deliberately keeps clear of the credits.
 */
export const AUDIO_FADE_OUT_SECONDS = 1

// Arm two seconds out — one whole spare timeUpdate. The curve holds at 1 until the
// last second, so arming early is free; Android's postDelayed clock drifts past 1s
// per sample (tvOS doesn't), so a one-interval margin gets stepped over and hard-cuts.
export const AUDIO_FADE_OUT_ARM_SECONDS = 2

/** Stepped from a JS timer: fine enough to be inaudible, cheap on the TV's JS thread. */
export const AUDIO_FADE_TICK_MS = 50

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** Linear ramp, clamped to expo-video's 0..1 volume range and to the fade's own span. */
export function volumeAtElapsed({
  from,
  to,
  elapsedMs,
  durationMs,
}: {
  from: number
  to: number
  elapsedMs: number
  durationMs: number
}): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return clamp01(to)
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return clamp01(from)
  if (elapsedMs >= durationMs) return clamp01(to)
  return clamp01(from + (to - from) * (elapsedMs / durationMs))
}

/**
 * Volume as a function of MEDIA time left, not of wall time elapsed — so whichever
 * sample happens to arm the fade, it still lands on silence exactly at the end. Holds
 * at full until the final second, which is what makes the early arm free.
 */
export function fadeOutVolumeAt({
  remainingSeconds,
}: {
  remainingSeconds: number
}): number {
  if (!Number.isFinite(remainingSeconds)) return 1
  return clamp01(remainingSeconds / AUDIO_FADE_OUT_SECONDS)
}

/**
 * The hop crossfade's duration: the outgoing dub ramps down while the incoming ramps up
 * over this span, so the two overlap with no silent gap between languages.
 */
export const AUDIO_CROSSFADE_MS = 500

/**
 * Equal-power crossfade gains at `elapsedMs` into the ramp: outgoing falls 1->0 as
 * incoming rises 0->1, with the two summing to constant PERCEIVED loudness (cos/sin, not
 * linear) so there is no dip at the midpoint — a seamless language handoff, not a gap.
 */
export function crossfadeGainsAt({
  elapsedMs,
  durationMs,
}: {
  elapsedMs: number
  durationMs: number
}): { outgoing: number; incoming: number } {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return { outgoing: 0, incoming: 1 }
  }
  const t = clamp01(
    (Number.isFinite(elapsedMs) ? elapsedMs : durationMs) / durationMs,
  )
  const quarterTurn = (t * Math.PI) / 2
  return { outgoing: Math.cos(quarterTurn), incoming: Math.sin(quarterTurn) }
}

/** True once the excerpt is close enough to its end to start watching the curve. */
export function shouldArmFadeOut({
  currentTime,
  window,
}: {
  currentTime: number
  window: ExcerptWindow
}): boolean {
  if (!Number.isFinite(currentTime)) return false
  return currentTime >= window.endSeconds - AUDIO_FADE_OUT_ARM_SECONDS
}

/**
 * Whether the timeUpdate handler should (re-)drive the fade-out. Keyed on the LOADED
 * token, not a bare boolean: the outgoing stream keeps emitting past its own end, and
 * a flag reset at swap time is re-armed by one of those late events — poisoning the
 * latch so the next excerpt never fades. Once armed for a token it re-bases only on a
 * sample that MOVED (a stalled player repeats its position, which would swell volume).
 */
export function shouldDriveFadeOut({
  armedForToken,
  loadedToken,
  positionMoved,
  currentTime,
  window,
}: {
  armedForToken: number | null
  loadedToken: number
  positionMoved: boolean
  currentTime: number
  window: ExcerptWindow
}): boolean {
  const armed = armedForToken === loadedToken
  if (armed && !positionMoved) return false
  return shouldArmFadeOut({ currentTime, window })
}

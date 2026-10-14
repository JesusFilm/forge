// The viewer's gestures on a playing part follow the app's Explore clips. A tap
// or a drag on the bar seeks. A hold on either side of the picture plays at 2x
// until the finger lifts, as on Instagram (the owner, 2026-10-14).

/** The playback rate while the viewer holds a side. */
export const PART_FAST_RATE = 2

/** A press held this long on a side starts the fast play, in ms. */
export const PART_FAST_HOLD_MS = 250

/** Each side that a hold speeds up, as a share of the window width. */
export const PART_FAST_SIDE_SHARE = 0.25

/** One screen-reader step on the bar, in seconds. */
export const PART_SEEK_STEP_SECONDS = 5

/** Is this x, in window points, on a side that a hold speeds up? */
export function onFastSide(x: number, width: number): boolean {
  if (!(width > 0) || !Number.isFinite(x)) return false
  const side = width * PART_FAST_SIDE_SHARE
  return x <= side || x >= width - side
}

/** m:ss for a place in a part, which is never an hour long. */
export function partClockLabel(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`
}

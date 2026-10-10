/**
 * Pure helpers for double-tap-the-sides seeking. No react-native imports — the
 * gesture timing/wiring in VideoPlayer is verified in-simulator.
 */

/** Window within which a second tap counts as a double tap (KTD6). 300ms
 *  matches the platform double-tap threshold; below it, deliberate double taps
 *  on slower devices misfire as two single taps. */
export const DOUBLE_TAP_MS = 300

/** Seek step (seconds) shared by the ±skip buttons and the double-tap-the-sides
 *  gesture, so the two surfaces can never drift apart. Matches YouTube's 10s. */
export const SKIP_SECONDS = 10

export type SeekSide = "left" | "right"

/** Which half of the player was tapped. Null when the width isn't known yet. */
export function seekSideForTap(
  locationX: number,
  width: number,
): SeekSide | null {
  if (!(width > 0)) return null
  return locationX < width / 2 ? "left" : "right"
}

/** Signed skip seconds for a side tap: left rewinds, right fast-forwards. */
export function seekDeltaForTap(
  locationX: number,
  width: number,
  skipSeconds: number,
): number {
  const side = seekSideForTap(locationX, width)
  if (side == null) return 0
  return side === "left" ? -skipSeconds : skipSeconds
}

/** Double-tap (→ seek) when a single-tap is already pending its DOUBLE_TAP_MS
 *  window; else starts a pending single-tap. Caller must cancel the pending
 *  single-tap on "double", else it fires after the seek and hides the chrome. */
export function classifyTap(singleTapPending: boolean): "double" | "single" {
  return singleTapPending ? "double" : "single"
}

/** What a resolved single-tap does once its window elapses with no second tap:
 *  hide only if the chrome was already visible when the press began. If it was
 *  hidden it was just revealed on press-in, so keep it up (R3). */
export function singleTapAction(wasVisible: boolean): "hide" | "keep" {
  return wasVisible ? "hide" : "keep"
}

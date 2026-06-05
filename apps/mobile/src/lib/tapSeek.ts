/**
 * Pure helpers for double-tap-the-sides seeking. No react-native imports — the
 * gesture timing/wiring in VideoPlayer is verified in-simulator.
 */

/** Window within which a second tap counts as a double tap (KTD6). 300ms
 *  matches the platform double-tap threshold; below it, deliberate double taps
 *  on slower devices misfire as two single taps. */
export const DOUBLE_TAP_MS = 300

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

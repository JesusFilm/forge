/**
 * R9/R10: while the floating window holds a LIVE video surface it owns the one
 * decoder, so every surface that mounts a video view of its own — Home's hero
 * pager and the SDUI hero — shows its poster and stays silent.
 *
 * Pure predicates, so the rule is one tested place instead of a boolean
 * expression re-derived at each surface. React-native-free like its siblings
 * here; the React subscription lives in `hooks/useMiniPlayerHoldsVideo.ts`.
 */

import type { MiniPlayerStoreSnapshot } from "./store"

/**
 * Keyed on the session PHASE, not on the session existing: an ended session
 * keeps the window on screen as a thumbnail with NO video surface (R21), and a
 * hero frozen until someone dismisses that thumbnail is the R9 regression.
 */
export function miniPlayerHoldsVideo(
  snapshot: MiniPlayerStoreSnapshot,
): boolean {
  return snapshot.session?.phase === "playing"
}

/**
 * Home's hero suspension. The window term sits BESIDE focus rather than
 * replacing it: the pop that opens the window fires Home's focus listener in
 * the same commit, so a focus-only resume would restart the hero under it.
 */
export function heroPlaybackPaused(input: {
  scrolledPast: boolean
  focused: boolean
  windowHoldsVideo: boolean
}): boolean {
  return input.scrolledPast || !input.focused || input.windowHoldsVideo
}

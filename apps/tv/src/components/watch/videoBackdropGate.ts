// Pure play/mount gate for VideoBackdrop. Kept React-free and colocated so the
// behavioral contract (R9/R10/R11/R15, AE1/AE2/AE4) is unit-testable without a
// render harness — apps/tv has none by convention (see WatchSessionProvider.test).

import type { AppStateStatus } from "react-native"

export type BackdropGateInputs = {
  /** Muted consumers (watch/Home/Search) opt out of lifecycle teardown. */
  muted: boolean
  /** Play gate — false while the hero is scrolled off-screen (pauses, stays mounted). */
  active: boolean
  /** Release the decode slot: a fullscreen overlay is open, or the screen was navigated away. */
  overlayVisible: boolean
  /** App is not backgrounded (only the unmuted hero acts on this). */
  appForeground: boolean
}

export type BackdropGate = {
  /** Decode + play (audible when unmuted). */
  shouldPlay: boolean
  /**
   * Mount the VideoView. Unmounts to release the scarce tvOS decode slot on
   * overlay / background / nav-away; scroll-off (active=false) only pauses and
   * stays mounted for instant resume (no competing decoder there).
   */
  shouldMountVideo: boolean
}

/**
 * Single source of truth for the play + mount gates so overlay, scroll, and
 * lifecycle can never race into two concurrent decoders (KTD4). Muted consumers
 * ignore `appForeground` (appGate stays true), so their gate reduces to today's
 * overlay-only behavior — default-inert (KTD1).
 */
export function computeBackdropGate({
  muted,
  active,
  overlayVisible,
  appForeground,
}: BackdropGateInputs): BackdropGate {
  const appGate = muted ? true : appForeground
  return {
    shouldPlay: active && !overlayVisible && appGate,
    shouldMountVideo: !overlayVisible && appGate,
  }
}

/**
 * True unless the app is genuinely backgrounded. Transient "inactive" (tvOS
 * Control Center, Siri, app-switcher peek) is NOT teardown — only "background"
 * releases the unmuted hero's decode slot + audio (R15).
 */
export function isAppStateForeground(state: AppStateStatus): boolean {
  return state !== "background"
}

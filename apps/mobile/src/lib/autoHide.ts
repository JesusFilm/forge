/**
 * Pure auto-hide gating logic for the video controls ("chrome"). Kept free of
 * react-native / expo imports so it is unit-testable without the RN runtime
 * (the hook that consumes it, useControlsVisibility, is verified in-simulator).
 */

export type AutoHideGate = {
  isPaused: boolean
  /** expo-video VideoPlayerStatus: 'idle' | 'loading' | 'readyToPlay' | 'error' */
  status: string
  screenReaderEnabled: boolean
}

/**
 * May the inactivity timer arm right now?
 *
 * Chrome stays pinned (timer never arms) while paused or ended (both surface as
 * not-playing → isPaused), while buffering/loading/error/idle, and while a
 * screen reader is active. It only auto-hides during steady playback.
 */
export function shouldArmHideTimer({
  isPaused,
  status,
  screenReaderEnabled,
}: AutoHideGate): boolean {
  if (isPaused) return false
  if (status !== "readyToPlay") return false
  if (screenReaderEnabled) return false
  return true
}

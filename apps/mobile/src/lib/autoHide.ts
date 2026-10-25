/**
 * Pure auto-hide gating for the video controls ("chrome"). No react-native /
 * expo imports so it is unit-testable without the RN runtime (consuming hook
 * useControlsVisibility is verified in-simulator).
 */

// Type-only import: erased at compile time, so this stays free of the
// expo-video runtime module and remains unit-testable without the RN runtime.
import type { VideoPlayerStatus } from "expo-video"

export type AutoHideGate = {
  isPaused: boolean
  /** expo-video VideoPlayerStatus: 'idle' | 'loading' | 'readyToPlay' | 'error'.
   *  Typed as the real union so a misspelled status literal is a compile error. */
  status: VideoPlayerStatus
  screenReaderEnabled: boolean
}

/**
 * May the inactivity timer arm right now? Stays pinned (never arms) while
 * paused/ended (both surface as isPaused), buffering/loading/error/idle, or a
 * screen reader is active. Only auto-hides during steady playback.
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

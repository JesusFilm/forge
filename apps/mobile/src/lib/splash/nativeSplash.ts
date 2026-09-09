/**
 * The native splash's two calls, behind one module so the hold and the release
 * cannot drift apart, and so the release stays a one-shot (KTD2).
 *
 * Every call is best-effort and never throws. The release runs on the two error
 * panels, where a rejected promise would mask the only surface the app has for
 * reporting a boot failure.
 */

import * as SplashScreen from "expo-splash-screen"

let hidden = false

/**
 * Holds the native splash until the React layer has painted. The CALL must sit
 * at module scope: Expo fires the auto-hide before a component's first effect,
 * so a later call has nothing left to prevent.
 */
export function preventNativeSplashAutoHide(): void {
  try {
    void SplashScreen.preventAutoHideAsync().catch(() => {})
  } catch {
    // A splash module that cannot hold is not a reason to fail startup.
  }
}

/** Releases the native splash. Every call after the first is a no-op. */
export function hideNativeSplashOnce(): void {
  if (hidden) return
  hidden = true
  try {
    void SplashScreen.hideAsync().catch(() => {})
  } catch {
    // The panel or the app tree beneath must render either way.
  }
}

/** Test seam only. */
export function resetNativeSplashState(): void {
  hidden = false
}

/**
 * The native splash's two calls, behind one module so the hold and the release
 * cannot drift apart, and so the release stays a one-shot (KTD2).
 *
 * Every call is best-effort and never throws. The release runs on the two error
 * panels, where a rejected promise would mask the only surface the app has for
 * reporting a boot failure.
 */

import * as SplashScreen from "expo-splash-screen"

import { datadogLog } from "../datadog"

let hidden = false

/** A failed release leaves a flat field over a working app, with nothing on
 *  screen to say so. Report it; never let the report itself throw. */
function report(call: "prevent" | "hide", error: unknown): void {
  try {
    datadogLog.warn("splash_native_call_failed", {
      splash_call: call,
      error_message: error instanceof Error ? error.message : String(error),
    })
  } catch {
    // Telemetry must never mask the surface this module exists to reveal.
  }
}

/**
 * Holds the native splash until the React layer has painted. The CALL must sit
 * at module scope: Expo fires the auto-hide before a component's first effect,
 * so a later call has nothing left to prevent.
 */
export function preventNativeSplashAutoHide(): void {
  try {
    void SplashScreen.preventAutoHideAsync().catch((error: unknown) => {
      report("prevent", error)
    })
  } catch (error) {
    report("prevent", error)
  }
}

/** Releases the native splash. Every call after the first is a no-op. */
export function hideNativeSplashOnce(): void {
  if (hidden) return
  hidden = true
  try {
    void SplashScreen.hideAsync().catch((error: unknown) => {
      report("hide", error)
    })
  } catch (error) {
    report("hide", error)
  }
}

/** Test seam only. */
export function resetNativeSplashState(): void {
  hidden = false
}

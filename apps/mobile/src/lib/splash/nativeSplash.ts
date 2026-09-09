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

/**
 * The unconditional release. Taking the hold removes the OS's own auto-hide, so
 * from that moment nothing outside JavaScript will ever lower the splash again;
 * this is the guarantee that replaces it.
 *
 * Comfortably past the longest legitimate path — the skip decision's 1s budget,
 * then the 6s ceiling, then the 350ms fade — so it only ever fires when the
 * normal path did not run at all.
 */
export const NATIVE_SPLASH_BACKSTOP_MS = 10_000

let hidden = false
let backstop: ReturnType<typeof setTimeout> | undefined

/** A failed release leaves a flat field over a working app, with nothing on
 *  screen to say so. Report it; never let the report itself throw. */
function report(event: string, attributes: Record<string, string>): void {
  try {
    datadogLog.warn(event, attributes)
  } catch {
    // Telemetry must never mask the surface this module exists to reveal.
  }
}

function reportCall(call: "prevent" | "hide", error: unknown): void {
  report("splash_native_call_failed", {
    splash_call: call,
    error_message: error instanceof Error ? error.message : String(error),
  })
}

/**
 * Holds the native splash until the React layer has painted. The CALL must sit
 * at module scope: Expo fires the auto-hide before a component's first effect,
 * so a later call has nothing left to prevent.
 */
export function preventNativeSplashAutoHide(): void {
  try {
    void SplashScreen.preventAutoHideAsync().catch((error: unknown) => {
      reportCall("prevent", error)
    })
  } catch (error) {
    reportCall("prevent", error)
  }
  // Armed on the same line that takes the hold, so no path can acquire one
  // without the other. Every route to the ordinary release runs in JavaScript,
  // and a person left under a flat field has no way forward at all.
  backstop ??= setTimeout(() => {
    if (hidden) return
    report("splash_native_backstop_fired", {
      backstop_ms: String(NATIVE_SPLASH_BACKSTOP_MS),
    })
    hideNativeSplashOnce()
  }, NATIVE_SPLASH_BACKSTOP_MS)
}

/** Releases the native splash. Every call after the first is a no-op. */
export function hideNativeSplashOnce(): void {
  if (hidden) return
  hidden = true
  if (backstop) {
    clearTimeout(backstop)
    backstop = undefined
  }
  try {
    void SplashScreen.hideAsync().catch((error: unknown) => {
      reportCall("hide", error)
    })
  } catch (error) {
    reportCall("hide", error)
  }
}

/** Test seam only. */
export function resetNativeSplashState(): void {
  hidden = false
  if (backstop) clearTimeout(backstop)
  backstop = undefined
}

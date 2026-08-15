/**
 * The ONE picture-in-picture wiring, shared by every capable surface (U9).
 *
 * Four render sites can hand a player to the operating system's window: the
 * shared watch surface (which backs both the watch screen and the
 * series-detail trailer), the floating mini player, and the two SDUI
 * `[sectionKey]` screens. All four spread this one props object, so all four
 * feed one latch. A predicate that reached only the sites a change already
 * touched, while siblings kept a hand-rolled copy, is a failure this repo has
 * recorded; `pictureInPictureCallSites.guard.test.js` holds the other half.
 */

import { isPictureInPictureSupported } from "expo-video"

import { setPictureInPictureActive } from "./pipLatch"

/** The `VideoView` props this module owns. A site spreads all of them. */
export type PictureInPictureViewProps = {
  allowsPictureInPicture: boolean
  startsPictureInPictureAutomatically: boolean
  onPictureInPictureStart: () => void
  onPictureInPictureStop: () => void
}

/** A `VideoView` ref, narrowed to the manual entry point. */
export type PictureInPictureStarter = {
  startPictureInPicture: () => Promise<void>
}

let supported: boolean | null = null

/**
 * R15's RUNTIME half: does this DEVICE support the OS window at all?
 *
 * Gated on the device, never on `Platform.OS` — an Android build without
 * `FEATURE_PICTURE_IN_PICTURE` and a web bundle both answer no while their
 * platform check would say yes.
 *
 * It inspects no manifest, so it cannot be the whole of R15. The build-time
 * half is `pictureInPictureManifest.guard.test.js`, which holds the app.json
 * flag that puts `android:supportsPictureInPicture` on the activity.
 */
export function isPictureInPictureAvailable(): boolean {
  if (supported != null) return supported
  try {
    supported = isPictureInPictureSupported()
    return supported
  } catch {
    // Answer no, but CACHE nothing: the probe can throw for a reason that is
    // not the device (no activity yet at cold launch), and one such call would
    // otherwise disable picture-in-picture everywhere for the whole process.
    return false
  }
}

/** Test teardown only: native support cannot change over an app's lifetime. */
export function resetPictureInPictureSupport(): void {
  supported = null
}

// Module scope so every surface passes the SAME function identity to its view.
const handleStart = () => setPictureInPictureActive(true)
const handleStop = () => setPictureInPictureActive(false)

/**
 * The props every picture-in-picture-capable `VideoView` spreads.
 *
 * The callbacks are the VIEW's, not the player's, deliberately: one player is
 * shared between the full view and the floating window, so only the view knows
 * which surface the operating system took.
 *
 * `enabled` is how a surface opts OUT and still keeps the latch wired. The
 * series-detail trailer is the one that must: it autostarts with sound on a
 * browsing screen, so a viewer who presses HOME there would get a floating
 * window playing something they never chose to watch.
 */
export function pictureInPictureViewProps(
  enabled = true,
): PictureInPictureViewProps {
  const available = enabled && isPictureInPictureAvailable()
  return {
    allowsPictureInPicture: available,
    // R14: one behaviour across surfaces. Android auto-enters on HOME for any
    // eligible view without this; setting it is what makes iOS match.
    startsPictureInPictureAutomatically: available,
    // Wired even when the affordance is off: expo-video can put a view into the
    // mode by routes this app does not drive, and a latch that never arms
    // pauses the video the system just handed to the floating window.
    onPictureInPictureStart: handleStart,
    onPictureInPictureStop: handleStop,
  }
}

/**
 * Enter the operating system's window from app code.
 *
 * Wrapped on both axes because `startPictureInPicture` THROWS on a device that
 * does not support it and returns a promise that can reject. Either one
 * unhandled is a red box over a video the viewer is watching.
 */
export function startPictureInPicture(
  view: PictureInPictureStarter | null | undefined,
): void {
  if (view == null || !isPictureInPictureAvailable()) return
  try {
    void view.startPictureInPicture().catch(() => {})
  } catch {
    // Unsupported device, or the native view is already detached.
  }
}

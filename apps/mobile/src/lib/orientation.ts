/**
 * Orientation control for the custom video fullscreen.
 *
 * Every screen is portrait by default (global `lockPortrait()` at app root);
 * only the fullscreen player rotates. The native module is lazy-`require`d so a
 * static import of this file never pulls `expo-screen-orientation` into the
 * eager module graph (mirrors the white-screen-avoidance pattern in
 * `app/_layout.tsx`). All calls are best-effort — a rejection (or a missing
 * native module under a slim runtime) must never crash navigation.
 */
type ScreenOrientationModule = typeof import("expo-screen-orientation")

function load(): ScreenOrientationModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-screen-orientation") as ScreenOrientationModule
  } catch {
    return null
  }
}

/** Lock the whole app to upright portrait (no upside-down). */
export async function lockPortrait(): Promise<void> {
  const SO = load()
  if (!SO) return
  try {
    await SO.lockAsync(SO.OrientationLock.PORTRAIT_UP)
  } catch {
    // Orientation unavailable in this context — non-fatal.
  }
}

/**
 * Enter the fullscreen orientation: force landscape so the OS rotates
 * immediately, then relax to DEFAULT so the view follows the device
 * afterwards (landscape or portrait, excluding upside-down).
 */
export async function enterLandscapeFollowDevice(): Promise<void> {
  const SO = load()
  if (!SO) return
  try {
    await SO.lockAsync(SO.OrientationLock.LANDSCAPE)
    await SO.unlockAsync()
  } catch {
    // A partial failure (e.g. unlock rejects) is swallowed; exitToPortrait()
    // can always re-assert portrait independently.
  }
}

/** Re-lock the app to portrait when leaving fullscreen. */
export async function exitToPortrait(): Promise<void> {
  const SO = load()
  if (!SO) return
  try {
    await SO.lockAsync(SO.OrientationLock.PORTRAIT_UP)
  } catch {
    // Non-fatal.
  }
}

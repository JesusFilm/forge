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
 * Enter the fullscreen orientation: lock to landscape so the view rotates and
 * stays landscape (either landscape-left or -right as the device turns).
 *
 * We deliberately do NOT unlock to "follow the device" afterwards: on iOS
 * `unlockAsync()` immediately re-applies the device's current physical
 * orientation, which snaps a portrait-held phone straight back to portrait —
 * so the landscape nudge never takes (verified in the simulator). Locking to
 * LANDSCAPE is the robust, standard fullscreen behavior. Portrait fullscreen
 * is intentionally not offered while in this mode.
 */
export async function enterFullscreenLandscape(): Promise<void> {
  const SO = load()
  if (!SO) return
  try {
    await SO.lockAsync(SO.OrientationLock.LANDSCAPE)
  } catch {
    // Non-fatal — orientation unavailable in this context.
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

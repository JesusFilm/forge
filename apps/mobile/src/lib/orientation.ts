/**
 * Orientation control for the custom video fullscreen (only the player rotates;
 * app is portrait by default). Native module is lazy-`require`d to keep it out of
 * the eager module graph (white-screen avoidance); all calls are best-effort.
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
 * Rotate into landscape for fullscreen. The lock must be a SINGLE orientation:
 * the dual LANDSCAPE mask only permits landscape, and on iOS 16+ hardware the
 * geometry request then defers to the physical sensor — a portrait-held phone
 * stays portrait until the user tilts it (the sensor-less simulator rotates
 * either way, which hides this). We deliberately don't `unlockAsync()`
 * afterward: on iOS it re-applies the device's physical orientation, snapping a
 * portrait-held phone back to portrait so the landscape nudge never takes.
 */
export async function enterFullscreenLandscape(): Promise<void> {
  const SO = load()
  if (!SO) return
  try {
    await SO.lockAsync(SO.OrientationLock.LANDSCAPE_RIGHT)
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

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
 * Lock to LANDSCAPE for fullscreen. We deliberately don't `unlockAsync()`
 * afterward: on iOS it re-applies the device's physical orientation, snapping a
 * portrait-held phone back to portrait so the landscape nudge never takes.
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

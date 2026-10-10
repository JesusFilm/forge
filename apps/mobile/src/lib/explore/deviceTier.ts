/**
 * KTD3's static device tier. `expo-device` is read only here, so the native
 * module stays behind one seam. A null memory value is the unknown tier, and
 * `resolvePlayerMode` gives it two players.
 */

export type DeviceTier = { totalMemoryBytes: number | null }

/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Required lazily, so module init and jest never touch the native module. The
 * probe comes first: a dev client built before expo-device logs a red box when
 * the package loads, even when the throw is caught.
 */
function readTotalMemory(): unknown {
  try {
    const { requireOptionalNativeModule } = require("expo") as {
      requireOptionalNativeModule: (name: string) => unknown
    }
    if (requireOptionalNativeModule("ExpoDevice") == null) return null
    return (require("expo-device") as { totalMemory?: unknown }).totalMemory
  } catch {
    return null
  }
}
/* eslint-enable @typescript-eslint/no-require-imports */

export function readDeviceTier(): DeviceTier {
  const value = readTotalMemory()
  const known = typeof value === "number" && Number.isFinite(value) && value > 0
  return { totalMemoryBytes: known ? value : null }
}

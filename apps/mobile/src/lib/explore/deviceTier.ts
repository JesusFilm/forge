/**
 * KTD3's static device tier. `expo-device` is read only here, so the native
 * module stays behind one seam. A null memory value is the unknown tier, and
 * `resolvePlayerMode` gives it two players.
 */

export type DeviceTier = { totalMemoryBytes: number | null }

/* eslint-disable @typescript-eslint/no-require-imports */
/** Required lazily, so module init and jest never touch the native module. */
function readTotalMemory(): unknown {
  try {
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

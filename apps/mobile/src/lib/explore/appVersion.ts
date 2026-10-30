/**
 * The app version that keys Explore's device-stored verdicts: the timing
 * verdicts (KTD24) and the stored demotion (KTD3). An app update clears both.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
/** expo-constants ships with Expo, so this read adds no native module. */
export function readAppVersion(): string {
  try {
    const constants = require("expo-constants") as {
      default?: { expoConfig?: { version?: unknown } | null }
    }
    const version = constants.default?.expoConfig?.version
    return typeof version === "string" && version.length > 0
      ? version
      : "unknown"
  } catch {
    return "unknown"
  }
}
/* eslint-enable @typescript-eslint/no-require-imports */

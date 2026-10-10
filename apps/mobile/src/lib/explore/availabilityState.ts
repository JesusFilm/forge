// The rule for the Explore tab gate (KTD16). It reads no env, so tests reach
// the rule without loading src/env.ts. The binder in availability.ts supplies
// the real inputs.

// The sign-in gate's two spellings. Every other value stays off: this is an
// opt-in gate, not a boolean parser.
const ENABLED_VALUES = new Set(["1", "true"])

export type ExploreAvailabilityInputs = {
  /** The over-the-air constant. Off hides the tab in every bundle. */
  overTheAirEnabled: boolean
  isDev: boolean
  platform: string
  /** `EXPO_PUBLIC_EXPLORE_ENABLED`. */
  flagValue: string | undefined
  /** `EXPO_PUBLIC_EXPLORE_ANDROID_ENABLED`. Read on Android only. */
  androidFlagValue: string | undefined
}

function isOn(value: string | undefined): boolean {
  return ENABLED_VALUES.has(value ?? "")
}

export function resolveExploreAvailable({
  overTheAirEnabled,
  isDev,
  platform,
  flagValue,
  androidFlagValue,
}: ExploreAvailabilityInputs): boolean {
  if (!overTheAirEnabled) return false
  if (isDev) return true
  if (!isOn(flagValue)) return false
  // An EAS variable has one value for both platforms. Android testers stay
  // out until the low-end Android pass has run, so Android needs its own value.
  return platform !== "android" || isOn(androidFlagValue)
}

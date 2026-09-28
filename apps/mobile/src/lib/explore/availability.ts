// The one predicate for the Explore tab (KTD16). The rule lives in
// availabilityState; this module only binds it to the real inputs.

import { Platform } from "react-native"

import { env } from "../../env"
import { resolveExploreAvailable } from "./availabilityState"
import { EXPLORE_ENABLED } from "./constants"

// Resolved once: the tab is never toggled at runtime, because a flip remounts
// the whole NativeTabs navigator.
const EXPLORE_AVAILABLE = resolveExploreAvailable({
  overTheAirEnabled: EXPLORE_ENABLED,
  isDev: __DEV__,
  platform: Platform.OS,
  flagValue: env.EXPO_PUBLIC_EXPLORE_ENABLED,
  androidFlagValue: env.EXPO_PUBLIC_EXPLORE_ANDROID_ENABLED,
})

export function isExploreAvailable(): boolean {
  return EXPLORE_AVAILABLE
}

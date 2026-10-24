// Typed JS surface of the local TvSearchIntent Expo module (Android-only).
// Degrades to no-op everywhere else so callers need no platform forks.

import { requireOptionalNativeModule } from "expo"
import { Platform } from "react-native"

// Structural type (same rationale as tv-speech-recognizer): the shape callers
// rely on, independent of expo-modules-core's class generics.
type TvSearchIntentNativeModule = {
  consumeLaunchSearchQuery(): string | null
  addListener(
    eventName: "onSearchIntent",
    listener: (event: { query: string }) => void,
  ): { remove: () => void }
}

const nativeModule =
  Platform.OS === "android"
    ? requireOptionalNativeModule<TvSearchIntentNativeModule>("TvSearchIntent")
    : null

/**
 * One-shot read of an Assistant search query the app was LAUNCHED with
 * (cold start). Returns null when the launch was not an app-search intent.
 */
export function consumeLaunchSearchQuery(): string | null {
  try {
    return nativeModule?.consumeLaunchSearchQuery() ?? null
  } catch {
    return null
  }
}

/** Assistant search queries arriving while the app is already running. */
export function addSearchIntentListener(
  listener: (event: { query: string }) => void,
): { remove: () => void } {
  if (nativeModule == null) return { remove: () => {} }
  return nativeModule.addListener("onSearchIntent", listener)
}

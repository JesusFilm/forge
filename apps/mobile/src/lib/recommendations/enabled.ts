import { env } from "../../env"

/**
 * `EXPO_PUBLIC_RECOMMENDATIONS_ENABLED` is an opt-OUT switch: unset keeps the
 * client on, and only an explicit `false` / `0` turns it off. Expo inlines the
 * value at bundle time, so a flip needs an update publish to reach devices.
 */
export function parseRecommendationsEnabled(raw: string | undefined): boolean {
  const normalized = raw?.trim().toLowerCase()
  return normalized !== "false" && normalized !== "0"
}

export function isRecommendationClientEnabled(): boolean {
  return parseRecommendationsEnabled(env.EXPO_PUBLIC_RECOMMENDATIONS_ENABLED)
}

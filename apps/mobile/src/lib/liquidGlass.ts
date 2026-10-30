import { Platform } from "react-native"
import {
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect"

let cached: boolean | undefined

/**
 * True only on iOS when Liquid Glass and its API are both available (KTD1).
 * The first answer holds for the launch: a change to a `NativeTabs.Trigger`
 * `role` remounts the whole navigator.
 */
export function canUseLiquidGlass(): boolean {
  if (cached === undefined) {
    // isGlassEffectAPIAvailable guards iOS 26 betas that crash without it.
    cached =
      Platform.OS === "ios" &&
      isLiquidGlassAvailable() &&
      isGlassEffectAPIAvailable()
  }
  return cached
}

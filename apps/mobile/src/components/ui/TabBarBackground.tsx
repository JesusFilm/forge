import { Platform, StyleSheet } from "react-native"
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect"

import { TAB_BAR_MATERIAL_TINT, TAB_BAR_PILL_RADIUS } from "../../lib/tabBar"
import { PlatformBlur } from "./PlatformBlur"

/**
 * The tab bar's material. Returning null on Android is load-bearing: a non-null
 * element flips the bar's own backgroundColor to transparent, and off iOS
 * GlassView is a bare transparent View, so the bar would vanish.
 */
export function TabBarBackground() {
  if (Platform.OS !== "ios") return null

  // isGlassEffectAPIAvailable guards iOS 26 betas that crash without it.
  if (isLiquidGlassAvailable() && isGlassEffectAPIAvailable()) {
    return (
      <GlassView
        style={styles.material}
        glassEffectStyle="regular"
        colorScheme="dark"
        tintColor={TAB_BAR_MATERIAL_TINT}
      />
    )
  }

  return (
    <PlatformBlur
      style={[styles.material, { backgroundColor: TAB_BAR_MATERIAL_TINT }]}
      intensity={60}
      tint="dark"
    />
  )
}

const styles = StyleSheet.create({
  material: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: TAB_BAR_PILL_RADIUS,
  },
})

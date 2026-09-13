import { Platform, StyleSheet } from "react-native"
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect"

import { TAB_BAR_MATERIAL_TINT } from "../../lib/tabBar"
import { PlatformBlur } from "./PlatformBlur"

/**
 * The frosted material a bar sits on. Since feat-498 the navigator no longer
 * uses it — iOS runs the real UIKit tab bar, which draws its own — so the one
 * consumer is `SelectionActionBar`, which stands in the tab bar's place while
 * the native bar is hidden.
 *
 * Returning null off iOS is load-bearing: `GlassView` is a bare transparent
 * View there, so the caller would lose its ground entirely.
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
  },
})

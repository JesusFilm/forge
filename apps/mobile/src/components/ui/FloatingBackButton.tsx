import { Platform, Pressable, StyleSheet, View } from "react-native"
import { GlassView } from "expo-glass-effect"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useRouter } from "expo-router"

import { ACCENT, SURFACE_COLOR, hexToRgba } from "../../lib/color"
import { HORIZONTAL_PADDING } from "../../styles/shared"

type FloatingBackButtonProps = {
  /** Extra offset below the safe-area top. Default 4. */
  topOffset?: number
  /** Inset from the left edge. Default HORIZONTAL_PADDING. */
  sideOffset?: number
  /** The glyph. A surface whose back press MINIMIZES a player into the
   *  floating window shows "chevron-down"; plain navigation keeps the back
   *  chevron. */
  icon?: "chevron-back" | "chevron-down"
}

// Back button floating over full-bleed content; mirrors HomeHeader's glass button.
// `isInteractive` intentionally NOT set — inside a Pressable it flashes white on
// remount. See docs/solutions/best-practices/expo-glass-effect-interactive-flash-2026-04-08.md.
export function FloatingBackButton({
  topOffset = 4,
  sideOffset = HORIZONTAL_PADDING,
  icon = "chevron-back",
}: FloatingBackButtonProps) {
  const insets = useSafeAreaInsets()
  const router = useRouter()

  const handleBack = () => {
    // A cold deep link / cold launch lands here with an empty history stack,
    // where router.back() is a silent no-op — fall back to the tabs so the
    // button never dead-ends (the only escape on the skeleton/error states).
    if (router.canGoBack()) router.back()
    else router.replace("/(tabs)")
  }

  return (
    <View
      style={[
        styles.container,
        { top: insets.top + topOffset, left: sideOffset },
      ]}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={handleBack}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={12}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <GlassView
          style={styles.button}
          glassEffectStyle="regular"
          colorScheme="dark"
        >
          <Ionicons name={icon} size={24} color={ACCENT} />
        </GlassView>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    zIndex: 20,
  },
  pressed: {
    transform: [{ scale: 0.92 }],
  },
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      android: {
        backgroundColor: hexToRgba(SURFACE_COLOR, 0.6),
        overflow: "hidden" as const,
        // Composite above the textureView video surface on Android.
        elevation: 6,
      },
    }),
  },
})

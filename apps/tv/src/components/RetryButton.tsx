// The one "Try again" CTA (shared "cta" focus role). onFocus/onBlur + state,
// not the `({ focused }) =>` callback: `focused` exists at runtime in
// react-native-tvos but not in upstream PressableStateCallbackType (strict tsc).

import { Animated, Pressable, StyleSheet, Text } from "react-native"

import { COLORS } from "../lib/colors"
import { scale } from "../lib/scale"
import { FOCUS_RING_COLOR } from "./focus/focusVisual"
import { useFocusVisual } from "./focus/useFocusVisual"

type RetryButtonProps = {
  onPress: () => void
  accessibilityHint?: string
  /** Surface accent for the fill + focus glow. Crimson by default (series/legacy);
   *  WATCH surfaces pass WATCH_THEME.accent. */
  accent?: string
  label?: string
  hasTVPreferredFocus?: boolean
}

export function RetryButton({
  onPress,
  accessibilityHint = "Reloads this page",
  accent = COLORS.primary,
  label = "Try again",
  hasTVPreferredFocus = true,
}: RetryButtonProps) {
  const { focused, setFocused, transform, focusedShadow, androidFocusProps } =
    useFocusVisual("cta", { accentColor: accent })
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
    >
      <Animated.View
        {...androidFocusProps}
        style={[
          styles.pill,
          { backgroundColor: accent },
          focused && styles.pillFocused,
          focused && focusedShadow,
          { transform },
        ]}
      >
        <Text style={styles.label}>{label}</Text>
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: scale(32),
    paddingVertical: scale(14),
    borderRadius: scale(24),
    // Reserve the focus border so toggling its color never shifts layout.
    borderWidth: scale(3),
    borderColor: "transparent",
  },
  pillFocused: {
    borderColor: FOCUS_RING_COLOR,
  },
  label: {
    fontFamily: "System",
    fontSize: Math.round(scale(18)),
    fontWeight: "600",
    color: COLORS.text,
  },
})

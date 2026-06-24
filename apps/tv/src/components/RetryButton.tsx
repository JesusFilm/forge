// Focusable "Try again" control for full-screen error states. Uses onFocus/onBlur
// + state, not the `({ focused }) =>` callback: `focused` exists at runtime in
// react-native-tvos but not in upstream PressableStateCallbackType (fails strict tsc).

import { useState } from "react"
import { Pressable, StyleSheet, Text } from "react-native"

import { COLORS } from "../lib/colors"
import { scale } from "../lib/scale"

type RetryButtonProps = {
  onPress: () => void
  accessibilityHint?: string
}

export function RetryButton({
  onPress,
  accessibilityHint = "Reloads this page",
}: RetryButtonProps) {
  const [isFocused, setIsFocused] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Try again"
      accessibilityHint={accessibilityHint}
      hasTVPreferredFocus
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      style={[styles.retryButton, isFocused && styles.retryButtonFocused]}
      onPress={onPress}
    >
      <Text style={styles.retryText}>Try again</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  retryButton: {
    paddingHorizontal: scale(32),
    paddingVertical: scale(14),
    borderRadius: scale(24),
    backgroundColor: COLORS.primary,
    // Reserve the focus border so toggling its color never shifts layout.
    borderWidth: scale(3),
    borderColor: "transparent",
  },
  // Matches the home Play/See More CTA: white border + red drop shadow on the
  // red fill (not a crimson glow).
  retryButtonFocused: {
    transform: [{ scale: 1.05 }],
    borderColor: "rgba(255,255,255,0.9)",
    shadowColor: COLORS.primary,
    shadowRadius: scale(20),
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 0 },
  },
  retryText: {
    fontFamily: "System",
    fontSize: Math.round(scale(18)),
    fontWeight: "600",
    color: COLORS.text,
  },
})

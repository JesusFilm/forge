// The quiet close (R21, R22): a 44 pt target at the top-left of every step.
// On a screen it sits in the safe area. On a video part it sits in the top
// letterbox, clear of the captions burned into the video (R24).
import Ionicons from "@expo/vector-icons/Ionicons"
import { Pressable, StyleSheet } from "react-native"

import { pauseColors, pauseSpacing } from "../../lib/dailyPause/theme"
import { useTopRowTop, type TopRowPlacement } from "./useTopRowTop"

export const TARGET_SIZE = 44
const GLYPH_SIZE = 24

type CloseButtonProps = {
  onPress: () => void
  placement: TopRowPlacement
}

export function CloseButton({ onPress, placement }: CloseButtonProps) {
  const top = useTopRowTop(placement, TARGET_SIZE)

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Close"
      style={({ pressed }) => [
        styles.close,
        { top },
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name="close" size={GLYPH_SIZE} color={pauseColors.muted} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  // The glyph's left edge lines up with the body column's side padding.
  close: {
    position: "absolute",
    left: pauseSpacing.screenSide - (TARGET_SIZE - GLYPH_SIZE) / 2,
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.6 },
})

// The quiet close (R21, R22): a 44 pt target at the top-left of every step, at
// the safe area's edge. On a video part that is the marker row, over the
// picture (the owner, 2026-10-14).
import Ionicons from "@expo/vector-icons/Ionicons"
import { Pressable, StyleSheet } from "react-native"

import { pauseColors, pauseSpacing } from "../../lib/dailyPause/theme"
import { useTopRowTop } from "./useTopRowTop"

export const TARGET_SIZE = 44
const GLYPH_SIZE = 24
const LEFT = pauseSpacing.screenSide - (TARGET_SIZE - GLYPH_SIZE) / 2
/** The close's right edge, which the section markers keep clear of. */
export const CLOSE_RIGHT_EDGE = LEFT + TARGET_SIZE

type CloseButtonProps = {
  onPress: () => void
}

export function CloseButton({ onPress }: CloseButtonProps) {
  const top = useTopRowTop()

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
    left: LEFT,
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.6 },
})

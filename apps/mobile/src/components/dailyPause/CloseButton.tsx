// The quiet close (R21, R22): a 44 pt target at the top-left of every step.
// On a screen it sits in the safe area. On a video part it sits in the top
// letterbox, clear of the captions burned into the video (R24).
import Ionicons from "@expo/vector-icons/Ionicons"
import { Pressable, StyleSheet, useWindowDimensions } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { pauseColors, pauseSpacing } from "../../lib/dailyPause/theme"

const TARGET_SIZE = 44
const GLYPH_SIZE = 24

/** The devotional videos are 1080 x 1920. */
const VIDEO_ASPECT = 1080 / 1920

/** Where a contain-fit devotional video sits in a window of this size. */
export function devotionalVideoFrame(
  width: number,
  height: number,
): { top: number; height: number } {
  const videoHeight = Math.min(height, width / VIDEO_ASPECT)
  return { top: (height - videoHeight) / 2, height: videoHeight }
}

type CloseButtonProps = {
  onPress: () => void
  placement: "screen" | "letterbox"
}

export function CloseButton({ onPress, placement }: CloseButtonProps) {
  const insets = useSafeAreaInsets()
  const window = useWindowDimensions()
  // The target's bottom edge meets the video's top edge, so the glyph never
  // covers the picture, even where the letterbox is shorter than the inset.
  const top =
    placement === "screen"
      ? insets.top
      : Math.max(
          0,
          devotionalVideoFrame(window.width, window.height).top - TARGET_SIZE,
        )

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

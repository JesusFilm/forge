// A developer-only Skip at the top-right of the steps that hold the run for a
// time: the three video parts and the Reflect and Pray countdowns. The run
// screen renders it only under __DEV__, so a release bundle drops it.
import Ionicons from "@expo/vector-icons/Ionicons"
import { Pressable, StyleSheet, Text, useWindowDimensions } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { pauseColors, pauseSpacing } from "../../lib/dailyPause/theme"
import { devotionalVideoFrame } from "./CloseButton"
import type { PauseFont } from "./WatchScreen"

const TARGET_HEIGHT = 44
const GLYPH_SIZE = 16
const SIDE_PADDING = 10

type DevSkipButtonProps = {
  onPress: () => void
  placement: "screen" | "letterbox"
  font: PauseFont
}

export function DevSkipButton({
  onPress,
  placement,
  font,
}: DevSkipButtonProps) {
  const insets = useSafeAreaInsets()
  const window = useWindowDimensions()
  // The same row as the close, so it never covers the picture.
  const top =
    placement === "screen"
      ? insets.top
      : Math.max(
          0,
          devotionalVideoFrame(window.width, window.height).top - TARGET_HEIGHT,
        )

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Skip this step (developer)"
      style={({ pressed }) => [styles.skip, { top }, pressed && styles.pressed]}
    >
      <Text style={[styles.label, font("sansMedium")]}>DEV SKIP</Text>
      <Ionicons
        name="play-skip-forward"
        size={GLYPH_SIZE}
        color={pauseColors.muted}
      />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  skip: {
    position: "absolute",
    right: pauseSpacing.screenSide - SIDE_PADDING,
    height: TARGET_HEIGHT,
    paddingHorizontal: SIDE_PADDING,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  label: {
    color: pauseColors.muted,
    fontSize: 12,
    letterSpacing: 1.2,
  },
  pressed: { opacity: 0.6 },
})

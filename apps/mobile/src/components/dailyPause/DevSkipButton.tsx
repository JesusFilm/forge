// A developer-only Skip at the top-right of the steps that hold the run for a
// time: the three video parts and the Reflect and Pray countdowns. The run
// screen renders it only under __DEV__, so a release bundle drops it.
import Ionicons from "@expo/vector-icons/Ionicons"
import { Pressable, StyleSheet, Text } from "react-native"

import { pauseText, type PauseFont } from "../../lib/dailyPause/fonts"
import {
  pauseColors,
  pauseSpacing,
  pauseType,
} from "../../lib/dailyPause/theme"
import { useTopRowTop, type TopRowPlacement } from "./useTopRowTop"

const TARGET_HEIGHT = 44
const GLYPH_SIZE = 16
const SIDE_PADDING = 10

type DevSkipButtonProps = {
  onPress: () => void
  placement: TopRowPlacement
  font: PauseFont
}

export function DevSkipButton({
  onPress,
  placement,
  font,
}: DevSkipButtonProps) {
  // The same row as the close, so it never covers the picture.
  const top = useTopRowTop(placement, TARGET_HEIGHT)

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Skip this step (developer)"
      style={({ pressed }) => [styles.skip, { top }, pressed && styles.pressed]}
    >
      <Text style={[styles.label, pauseText(font, pauseType.label)]}>
        DEV SKIP
      </Text>
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
  },
  pressed: { opacity: 0.6 },
})

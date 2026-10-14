// A developer-only Skip on the steps that hold the run for a time: the video
// parts and the Reflect and Pray countdowns. The run screen renders it only
// under __DEV__, so a release bundle drops it.
import Ionicons from "@expo/vector-icons/Ionicons"
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"

import { pauseText, type PauseFont } from "../../lib/dailyPause/fonts"
import { pauseColors, pauseSizes, pauseType } from "../../lib/dailyPause/theme"
import { RUN_BAR_CLEARANCE } from "../../lib/dailyPause/videoFrame"
import { useRunVideoLayout } from "./useTopRowTop"

const GLYPH_SIZE = 16
const SIDE_PADDING = 10
/** Below the bar's touch strip there is only the home indicator's band, so the
 *  Skip there is short enough to clear the indicator's pill. */
const FOOTER_HEIGHT = 24

type DevSkipButtonProps = {
  onPress: () => void
  font: PauseFont
}

export function DevSkipButton({ onPress, font }: DevSkipButtonProps) {
  const { barTop } = useRunVideoLayout()
  const window = useWindowDimensions()

  // One place on every step (the owner, 2026-10-14): centred below a video's
  // timeline, where the bar's touch strip ends. With no home indicator the
  // strip ends at the screen's foot, so the Skip moves up and gets shorter.
  const barFoot = barTop + pauseSizes.progressBarHeight
  const footerTop = Math.max(
    barFoot,
    Math.min(barFoot + RUN_BAR_CLEARANCE, window.height - FOOTER_HEIGHT),
  )
  const footerHeight = Math.min(FOOTER_HEIGHT, window.height - footerTop)

  return (
    <View
      testID="dev-skip-footer"
      pointerEvents="box-none"
      style={[styles.footer, { top: footerTop, height: footerHeight }]}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Skip this step (developer)"
        style={({ pressed }) => [
          styles.skip,
          { height: footerHeight },
          pressed && styles.pressed,
        ]}
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
    </View>
  )
}

const styles = StyleSheet.create({
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  skip: {
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

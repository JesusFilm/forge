// The thin bar of a video part (R12). It sits in the top letterbox, where the
// Figma frame draws it, so it stays clear of the captions and the gold ring
// that are burned into the video (R24).
import { Animated, StyleSheet, View } from "react-native"

import { pauseColors, pauseSizes } from "../../lib/dailyPause/theme"

type PartProgressBarProps = {
  /** 0 to 1. The part player writes it once a frame, with no render. */
  progress: Animated.Value
  /** The bar's top edge in window points. */
  top: number
}

export function PartProgressBar({ progress, top }: PartProgressBarProps) {
  return (
    <View
      testID="part-progress"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.track, { top }]}
    >
      <Animated.View
        testID="part-progress-fill"
        style={[styles.fill, { transform: [{ scaleX: progress }] }]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  track: {
    position: "absolute",
    left: 0,
    right: 0,
    height: pauseSizes.progressBarHeight,
    backgroundColor: pauseColors.progressTrack,
    overflow: "hidden",
  },
  fill: {
    width: "100%",
    height: "100%",
    backgroundColor: pauseColors.white,
    transformOrigin: "left center",
  },
})

import { useEffect, useRef } from "react"
import { Animated, Easing, StyleSheet } from "react-native"

import { TEXT_ON_OVERLAY, hexToRgba } from "../../lib/color"

const SIZE = 40
const THICKNESS = 3
const SPIN_MS = 900
const TRACK_ALPHA = 0.25

type CircularSpinnerProps = {
  size?: number
  /** Hex only — the dim track is derived from it via hexToRgba, which yields
   *  rgba(NaN, ...) for a named colour or an rgb() string. */
  color?: string
}

/**
 * Indeterminate circular indicator — a dim ring with one bright arc, rotating.
 * Replaces the platform ActivityIndicator's spoke wheel. Like the skeleton
 * shimmer, this is functional feedback, so it is NOT reduce-motion gated.
 */
export function CircularSpinner({
  size = SIZE,
  color = TEXT_ON_OVERLAY,
}: CircularSpinnerProps) {
  const progress = useRef(new Animated.Value(0)).current
  // Built once so the value attached to the view stays stable across renders.
  const rotate = useRef(
    progress.interpolate({
      inputRange: [0, 1],
      outputRange: ["0deg", "360deg"],
    }),
  ).current

  useEffect(() => {
    // Fabric gotchas (same as useShimmerOpacity): loop a SINGLE 0→1 timing —
    // a looped Animated.sequence freezes after one pass — and stay on the
    // native driver, which the JS driver does not update at all on this build.
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: SPIN_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    )
    loop.start()
    return () => loop.stop()
  }, [progress])

  return (
    <Animated.View
      style={[
        styles.ring,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: hexToRgba(color, TRACK_ALPHA),
          borderTopColor: color,
          transform: [{ rotate }],
        },
      ]}
    />
  )
}

const styles = StyleSheet.create({
  ring: {
    borderWidth: THICKNESS,
  },
})

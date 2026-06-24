import { useEffect, useMemo, useRef, useState } from "react"
import { Animated, Easing, type ViewStyle } from "react-native"

import { scale } from "../../lib/scale"

// 0→1 "focus progress" so highlights glide in (timing/easing match the mockup's
// .18s cubic-bezier). JS-driven on purpose: callers interpolate it into
// backgroundColor/borderColor/shadowOpacity, which the native driver can't animate.
const FOCUS_DURATION_MS = 180

export function useFocusAnimation() {
  const [focused, setFocused] = useState(false)
  const progress = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: focused ? 1 : 0,
      duration: FOCUS_DURATION_MS,
      easing: Easing.bezier(0.22, 0.61, 0.36, 1),
      useNativeDriver: false,
    })
    animation.start()
    return () => animation.stop()
  }, [focused, progress])

  return { focused, setFocused, progress }
}

// Shared tvOS-magnify transform (lift + scale) from focus progress; pills and Up
// Next cards reuse it with different magnitudes. Memoize at the call site (keyed on
// stable `progress`) so interpolations aren't reallocated per focus/blur re-render.
export function focusTransform(
  progress: Animated.Value,
  opts?: { lift?: number; magnify?: number },
) {
  const lift = opts?.lift ?? scale(4)
  const magnify = opts?.magnify ?? 1.06
  return [
    {
      translateY: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, -lift],
      }),
    },
    {
      scale: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [1, magnify],
      }),
    },
  ]
}

/** White focus-ring width shared by HomeCard and the Up Next / Episodes rails. */
export const FOCUS_RING_WIDTH = scale(5)

// Neutral dark drop shadow under a focused thumb. iOS-only shadow props (Android
// TV shows the border ring instead); pair with useThumbFocusRing's ring.
export const THUMB_SHADOW = {
  shadowColor: "#000000",
  shadowRadius: scale(25),
  shadowOffset: { width: 0, height: scale(16) },
} as const

// Home-card focus treatment for a fixed-size thumb: an animated neutral drop
// shadow + a white ring hugging the thumb, both driven by focus `progress`.
// Single source for HomeCard / EpisodeRail / UpNextRail (was 3 inline copies).
export function useThumbFocusRing(
  progress: Animated.Value,
  cardWidth: number,
  thumbHeight: number,
  cardRadius: number = scale(16),
) {
  const shadowStyle = useMemo(
    () => ({
      shadowOpacity: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 0.8],
      }),
    }),
    [progress],
  )
  const ringStyle = useMemo(() => ({ opacity: progress }), [progress])
  const ringFrame = useMemo<ViewStyle>(
    () => ({
      position: "absolute",
      top: -FOCUS_RING_WIDTH,
      left: -FOCUS_RING_WIDTH,
      width: cardWidth + FOCUS_RING_WIDTH * 2,
      height: thumbHeight + FOCUS_RING_WIDTH * 2,
      borderRadius: cardRadius + FOCUS_RING_WIDTH,
      borderWidth: FOCUS_RING_WIDTH,
      borderColor: "rgba(255,255,255,0.88)",
    }),
    [cardWidth, thumbHeight, cardRadius],
  )
  return { shadowStyle, ringStyle, ringFrame }
}

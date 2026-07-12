// Adapter over the shared focus module (src/components/focus/) — the curve,
// ring, and shadow constants live there. Kept so this file's 14 consumers keep
// their imports; new call sites should use useFocusVisual directly.

import { useMemo, useState } from "react"
import { Animated, type ViewStyle } from "react-native"

import { scale } from "../../lib/scale"
import {
  FOCUS_RING_COLOR,
  FOCUS_RING_WIDTH as MODULE_RING_WIDTH,
  focusShadowStyle,
  resolveFocusVisual,
} from "../focus/focusVisual"
import { useFocusProgress } from "../focus/useFocusVisual"

// 0→1 focus-progress so highlights glide in. JS-driven by default: callers
// interpolate color/shadow, which the native driver can't animate. Pass
// { nativeDriver: true } ONLY for transform/opacity-only callers.
export function useFocusAnimation(opts?: { nativeDriver?: boolean }) {
  const [focused, setFocused] = useState(false)
  const progress = useFocusProgress(focused, opts)
  return { focused, setFocused, progress }
}

// Shared focus lift+scale transform (transform-only → safe with the native driver
// on both platforms). Memoize at the call site (keyed on `progress`) so the
// interpolations aren't reallocated on every focus/blur re-render.
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
export const FOCUS_RING_WIDTH = MODULE_RING_WIDTH

// Neutral dark drop shadow under a focused thumb (module "thumb" preset).
// iOS-only shadow props (Android TV shows the border ring instead); pair with
// useThumbFocusRing's ring.
const THUMB_SPEC = resolveFocusVisual("thumb")
export const THUMB_SHADOW = {
  shadowColor: focusShadowStyle(THUMB_SPEC.shadow).shadowColor,
  shadowRadius: THUMB_SPEC.shadow.radius,
  shadowOffset: { width: 0, height: THUMB_SPEC.shadow.offsetY },
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
        outputRange: [0, THUMB_SPEC.shadow.opacity],
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
      borderColor: FOCUS_RING_COLOR,
    }),
    [cardWidth, thumbHeight, cardRadius],
  )
  return { shadowStyle, ringStyle, ringFrame }
}

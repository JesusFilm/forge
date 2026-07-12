// The one focus engine. Owns focused state, the single timing curve, the
// role-preset transform, and the Android focus-compositing props. Ring/shadow
// application stays at the call site (overlay vs border swap), on the shared
// constants from focusVisual.ts.

import { useEffect, useMemo, useRef, useState } from "react"
import { Animated, Easing, Platform, type ViewStyle } from "react-native"

import { scale } from "../../lib/scale"
import {
  FOCUS_DURATION_MS,
  FOCUS_EASING_BEZIER,
  FOCUS_RING_COLOR,
  FOCUS_RING_WIDTH,
  focusShadowStyle,
  resolveFocusVisual,
  type FocusVisualRole,
  type FocusVisualSpec,
} from "./focusVisual"

const [x1, y1, x2, y2] = FOCUS_EASING_BEZIER

// JS-driven by default: several callers interpolate color/shadow off the same
// progress, which the native driver can't animate. Pass { nativeDriver: true }
// ONLY for transform/opacity-only callers.
export function useFocusProgress(
  focused: boolean,
  opts?: { nativeDriver?: boolean },
) {
  const nativeDriver = opts?.nativeDriver ?? false
  const progress = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: focused ? 1 : 0,
      duration: FOCUS_DURATION_MS,
      easing: Easing.bezier(x1, y1, x2, y2),
      useNativeDriver: nativeDriver,
    })
    animation.start()
    return () => animation.stop()
  }, [focused, progress, nativeDriver])

  return progress
}

// Low-level primitive: focused state + 0→1 progress on the one curve. For
// color-only cross-fade sites; standard visuals should use useFocusVisual(role).
export function useFocusAnimation(opts?: { nativeDriver?: boolean }) {
  const [focused, setFocused] = useState(false)
  const progress = useFocusProgress(focused, opts)
  return { focused, setFocused, progress }
}

/** Lift+scale transform for a spec (transform-only, native-driver safe). */
export function specTransform(progress: Animated.Value, spec: FocusVisualSpec) {
  return [
    {
      translateY: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, -spec.lift],
      }),
    },
    {
      scale: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [1, spec.magnify],
      }),
    },
  ]
}

export function useFocusVisual(
  role: FocusVisualRole,
  opts?: {
    nativeDriver?: boolean
    magnify?: number
    lift?: number
    /** Fill color for "accent" shadows (the CTA glow). */
    accentColor?: string
  },
) {
  const [focused, setFocused] = useState(false)
  // Transform-only by default here; callers animating color/shadow off
  // `progress` must pass nativeDriver: false.
  const progress = useFocusProgress(focused, {
    nativeDriver: opts?.nativeDriver ?? true,
  })
  // Memoized so the returned transform/shadow keep their identity across
  // focus/blur re-renders — call sites memo on these being stable.
  const magnify = opts?.magnify
  const lift = opts?.lift
  const spec = useMemo(
    () => resolveFocusVisual(role, { magnify, lift }),
    [role, magnify, lift],
  )

  const transform = useMemo(
    () => specTransform(progress, spec),
    [progress, spec],
  )

  const accentColor = opts?.accentColor
  const focusedShadow = useMemo(
    () => focusShadowStyle(spec.shadow, accentColor),
    [spec, accentColor],
  )

  // Focused Android views composite off-screen so the scaled card + ring render
  // as one hardware texture (no seams). Spread onto the animated container.
  const androidFocusProps = {
    needsOffscreenAlphaCompositing: Platform.OS === "android" && focused,
    renderToHardwareTextureAndroid: focused,
  }

  return {
    focused,
    setFocused,
    progress,
    spec,
    transform,
    focusedShadow,
    androidFocusProps,
  }
}

// ── Thumb-card focus treatment ──────────────────────────────────────────────

const THUMB_SPEC = resolveFocusVisual("thumb")

// Neutral dark drop shadow under a focused thumb (the "thumb" preset). iOS-only
// shadow props (Android TV shows the border ring instead); pair with
// useThumbFocusRing's ring.
export const THUMB_SHADOW = {
  shadowColor: "#000000",
  shadowRadius: THUMB_SPEC.shadow.radius,
  shadowOffset: { width: 0, height: THUMB_SPEC.shadow.offsetY },
} as const

// Animated neutral drop shadow + a white ring hugging a fixed-size thumb, both
// driven by focus `progress`. Single source for HomeCard / EpisodeRail /
// UpNextRail.
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

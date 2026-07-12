// The one focus engine. Owns focused state, the single timing curve, the
// role-preset transform, and the Android focus-compositing props. Ring/shadow
// application stays at the call site (overlay vs border swap), on the shared
// constants from focusVisual.ts.

import { useEffect, useMemo, useRef, useState } from "react"
import { Animated, Easing, Platform } from "react-native"

import {
  FOCUS_DURATION_MS,
  FOCUS_EASING_BEZIER,
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
  const spec = resolveFocusVisual(role, {
    magnify: opts?.magnify,
    lift: opts?.lift,
  })

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

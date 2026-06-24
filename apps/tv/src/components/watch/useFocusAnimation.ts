import { useEffect, useRef, useState } from "react"
import { Animated, Easing } from "react-native"

import { scale } from "../../lib/scale"

// Drives a 0→1 focus-progress value so highlights glide in (timing/easing match
// the design's .18s cubic-bezier(.22,.61,.36,1)). Re-firing mid-animation eases
// from the current value, so rapid D-pad navigation stays smooth.
//
// JS-driven by default (callers interpolate color/shadow, which the native driver
// can't animate). Pass { nativeDriver: true } ONLY for transform/opacity-only
// callers (never color/shadow) — Android uses it to get the tween off the JS thread.
const FOCUS_DURATION_MS = 180

export function useFocusAnimation(opts?: { nativeDriver?: boolean }) {
  const nativeDriver = opts?.nativeDriver ?? false
  const [focused, setFocused] = useState(false)
  const progress = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: focused ? 1 : 0,
      duration: FOCUS_DURATION_MS,
      easing: Easing.bezier(0.22, 0.61, 0.36, 1),
      useNativeDriver: nativeDriver,
    })
    animation.start()
    return () => animation.stop()
  }, [focused, progress, nativeDriver])

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

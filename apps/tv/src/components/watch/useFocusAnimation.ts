import { useEffect, useRef, useState } from "react"
import { Animated, Easing } from "react-native"

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

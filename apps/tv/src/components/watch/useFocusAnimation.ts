import { useEffect, useRef, useState } from "react"
import { Animated, Easing } from "react-native"

import { scale } from "../../lib/scale"

// Drives a 0→1 "focus progress" value so focus highlights glide in instead of
// snapping ("just a blink"). Timing + easing match the design mockup's focus
// transition (`transition: … .18s cubic-bezier(.22,.61,.36,1)`).
//
// JS-driven (useNativeDriver: false) on purpose: callers interpolate it into
// backgroundColor / borderColor / shadowOpacity, none of which the native
// animation driver can animate. Focus transitions are brief and infrequent, so
// the JS-thread cost is negligible. Re-firing mid-animation eases from the
// current value (no jump), so rapid D-pad navigation stays smooth.
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

// Shared tvOS-magnify transform (lift + scale) driven by focus progress. Pills
// and Up Next cards use the same shape with different magnitudes. Memoize the
// result at the call site (keyed on the stable `progress`) so the interpolations
// aren't reallocated on every focus/blur re-render.
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

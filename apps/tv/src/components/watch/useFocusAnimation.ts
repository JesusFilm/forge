import { useEffect, useRef, useState } from "react"
import { Animated, Easing } from "react-native"

import { scale } from "../../lib/scale"

// Drives a 0→1 "focus progress" value so focus highlights glide in instead of
// snapping ("just a blink"). Timing + easing match the design mockup's focus
// transition (`transition: … .18s cubic-bezier(.22,.61,.36,1)`).
//
// JS-driven by DEFAULT: most callers interpolate progress into backgroundColor /
// borderColor / shadowOpacity, none of which the native animation driver can
// animate. Re-firing mid-animation eases from the current value (no jump), so
// rapid D-pad navigation stays smooth.
//
// Pass `{ nativeDriver: true }` for callers that drive ONLY transform / opacity.
// That moves the per-focus tween off the JS thread — which matters on Android TV:
// the home mounts ~50 rail cards, each running this 180ms tween on the focused
// AND blurred card every D-pad move, and on the Chromecast's weak SoC the
// JS-thread tween dominated frame time. A native caller MUST NOT interpolate
// progress into any color/shadow prop (the native driver can't animate those).
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

import { useEffect, useRef } from "react"
import { Animated } from "react-native"

const MIN_OPACITY = 0.3
const MAX_OPACITY = 1
const HALF_CYCLE_MS = 700

/**
 * A looping opacity value that fades a loading skeleton in and out, so it reads
 * as "still loading" rather than "loading failed".
 *
 * The loop starts synchronously and unconditionally — a loading pulse is
 * functional feedback (it tells the user work is in progress), so it is not
 * gated on reduce-motion. The motion is a gentle opacity fade, not large or
 * parallax movement.
 */
export function useShimmerOpacity(): Animated.Value {
  const opacity = useRef(new Animated.Value(MIN_OPACITY)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: MAX_OPACITY,
          duration: HALF_CYCLE_MS,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: MIN_OPACITY,
          duration: HALF_CYCLE_MS,
          useNativeDriver: true,
        }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [opacity])

  return opacity
}

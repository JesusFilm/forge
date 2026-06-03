import { useEffect, useRef } from "react"
import { AccessibilityInfo, Animated } from "react-native"

const MIN_OPACITY = 0.35
const MAX_OPACITY = 0.85
const HALF_CYCLE_MS = 750
const REDUCED_MOTION_OPACITY = 0.6

/**
 * A looping opacity value that fades a loading skeleton in and out, so it reads
 * as "still loading" rather than "loading failed".
 *
 * Respects the OS reduce-motion setting: instead of pulsing, it holds a steady
 * mid opacity (the skeleton's shape still signals loading without animation).
 */
export function useShimmerOpacity(): Animated.Value {
  const opacity = useRef(new Animated.Value(MIN_OPACITY)).current

  useEffect(() => {
    let cancelled = false
    let loop: Animated.CompositeAnimation | null = null

    const start = (reduceMotion: boolean) => {
      if (cancelled) return
      if (reduceMotion) {
        opacity.setValue(REDUCED_MOTION_OPACITY)
        return
      }
      loop = Animated.loop(
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
    }

    AccessibilityInfo.isReduceMotionEnabled()
      .then(start)
      .catch(() => start(false))

    return () => {
      cancelled = true
      loop?.stop()
    }
  }, [opacity])

  return opacity
}

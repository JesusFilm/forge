import { useEffect, useRef } from "react"
import { Animated, Easing } from "react-native"

const CYCLE_MS = 1400
const DIM = 0.35
const BRIGHT = 1

/**
 * Looping opacity that fades a skeleton in/out ("still loading", not "failed").
 * Fabric gotchas: loop a single 0→1 timing + interpolate (a looped
 * Animated.sequence freezes after one pulse); useNativeDriver (JS driver won't
 * update views here). Unconditional — functional feedback, not reduce-motion gated.
 */
export function useShimmerOpacity(): Animated.AnimatedInterpolation<number> {
  const progress = useRef(new Animated.Value(0)).current
  // Create the interpolation once so the value attached to the view is stable.
  const opacity = useRef(
    progress.interpolate({
      // 0 → dim, 0.5 → bright, 1 → dim. The loop's reset from 1 back to 0 is a
      // visual no-op (both map to DIM), so the pulse is seamless.
      inputRange: [0, 0.5, 1],
      outputRange: [DIM, BRIGHT, DIM],
    }),
  ).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: CYCLE_MS,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    )
    loop.start()
    return () => loop.stop()
  }, [progress])

  return opacity
}

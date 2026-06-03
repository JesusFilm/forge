import { useEffect, useRef } from "react"
import { Animated, Easing } from "react-native"

const CYCLE_MS = 1400
const DIM = 0.35
const BRIGHT = 1

/**
 * A continuously looping opacity value that fades a loading skeleton in and out,
 * so it reads as "still loading" rather than "loading failed".
 *
 * Implementation note: this loops a single 0→1 timing and interpolates it into
 * a dim→bright→dim triangle, rather than looping an Animated.sequence of two
 * timings. A looped *sequence* stops after one iteration on the New
 * Architecture; a looped *single timing* repeats reliably. It runs on the JS
 * driver so there is no native-side loop-once issue (a few opacity rects are
 * cheap to drive from JS). The loop starts unconditionally — a loading pulse is
 * functional feedback, not decorative motion, so it is not reduce-motion gated.
 */
export function useShimmerOpacity(): Animated.AnimatedInterpolation<number> {
  const progress = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: CYCLE_MS,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      }),
    )
    loop.start()
    return () => loop.stop()
  }, [progress])

  // 0 → dim, 0.5 → bright, 1 → dim. The loop's reset from 1 back to 0 is a
  // visual no-op (both map to DIM), so the pulse is seamless across iterations.
  return progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [DIM, BRIGHT, DIM],
  })
}

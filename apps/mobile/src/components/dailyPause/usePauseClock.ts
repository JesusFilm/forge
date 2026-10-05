// One native-driven clock from 0 to 1 over `totalMs`, from mount. The stepper
// and the screen intro read their phases from it as interpolations.
import { useEffect, useState } from "react"
import { Animated, Easing } from "react-native"

import { useReduceMotion } from "../../hooks/useReduceMotion"

export function usePauseClock(totalMs: number): {
  progress: Animated.Value
  reduceMotion: boolean
} {
  const reduceMotion = useReduceMotion()
  const [progress] = useState(() => new Animated.Value(0))
  const [, setEndRendered] = useState(false)

  useEffect(() => {
    if (reduceMotion) {
      // iOS ignores a plain value once the native driver has set the view, so
      // the clock moves to its end. A render follows, so the props read it too.
      progress.setValue(1)
      setEndRendered(true)
      return
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: totalMs,
      easing: Easing.linear,
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [progress, reduceMotion, totalMs])

  return { progress, reduceMotion }
}

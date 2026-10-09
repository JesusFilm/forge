// One native-driven clock from 0 to 1 over `totalMs`, from mount or from when
// `started` turns true. Each phase reads from it as an interpolation. restart()
// plays it again on a new value, and does nothing under Reduce Motion (KTD1).
import { useCallback, useEffect, useState } from "react"
import { Animated, Easing } from "react-native"

import { useReduceMotion } from "../../hooks/useReduceMotion"

type Run = { id: number; progress: Animated.Value }

export function usePauseClock(
  totalMs: number,
  started = true,
): {
  progress: Animated.Value
  reduceMotion: boolean
  /** Changes at each restart. A view that a run drives keys on it. */
  run: number
  restart: () => void
} {
  const reduceMotion = useReduceMotion()
  const [{ id: run, progress }, setRun] = useState<Run>(() => ({
    id: 0,
    progress: new Animated.Value(0),
  }))
  const [, setEndRendered] = useState(false)

  useEffect(() => {
    if (!started) return
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
  }, [progress, reduceMotion, started, totalMs])

  // A reset of the old value can lose to the native stop report, or reach the
  // view a frame late. A new value starts at 0 in the commit that mounts it.
  const restart = useCallback(() => {
    if (reduceMotion) return
    setRun((current) => ({
      id: current.id + 1,
      progress: new Animated.Value(0),
    }))
  }, [reduceMotion])

  return { progress, reduceMotion, run, restart }
}

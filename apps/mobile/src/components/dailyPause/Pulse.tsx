// A pulse that asks for a tap (the owner, 2026-10-06): once every two
// seconds, the child grows a little and settles. Reduce Motion keeps it still.
import { useEffect, useState, type ReactNode } from "react"
import { Animated, Easing, StyleSheet, View } from "react-native"

import { useReduceMotion } from "../../hooks/useReduceMotion"
import { sampledCurve } from "./sampledCurve"

export const PULSE_CYCLE_MS = 2000
export const PULSE_SCALE = 1.06
/** The swell's length. The rest of each cycle holds still. */
export const PULSE_SWELL_MS = 600
/** The scale over one cycle: one smooth swell, then rest. A looped sequence
 *  freezes on Fabric, so one looped timing carries the shape. */
function pulseScale(progress: Animated.Value) {
  return sampledCurve(progress, {
    fromMs: 0,
    spanMs: PULSE_SWELL_MS,
    totalMs: PULSE_CYCLE_MS,
    curve: (t) => 1 + (PULSE_SCALE - 1) * Math.sin(Math.PI * t),
  })
}

type PulseProps = {
  children: ReactNode
  /** The first swell waits this long, for an entrance to end first. */
  delayMs?: number
}

export function Pulse({ children, delayMs = 0 }: PulseProps) {
  const reduceMotion = useReduceMotion()
  const [progress] = useState(() => new Animated.Value(0))
  const [scale] = useState(() => pulseScale(progress))

  useEffect(() => {
    if (reduceMotion) return
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: PULSE_CYCLE_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    )
    let timer: ReturnType<typeof setTimeout> | null = null
    if (delayMs > 0) timer = setTimeout(() => loop.start(), delayMs)
    else loop.start()
    return () => {
      if (timer !== null) clearTimeout(timer)
      loop.stop()
    }
  }, [delayMs, progress, reduceMotion])

  // A new plain view, because iOS keeps the last native scale on the old one.
  if (reduceMotion) return <View style={styles.row}>{children}</View>
  return (
    <Animated.View
      testID="pause-pulse"
      style={[styles.row, { transform: [{ scale }] }]}
    >
      {children}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  row: { alignSelf: "stretch", alignItems: "center" },
})

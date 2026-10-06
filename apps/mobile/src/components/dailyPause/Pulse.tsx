// A pulse that asks for a tap (the owner, 2026-10-06): once a second, the
// child grows a little and settles. Reduce Motion keeps it still.
import { useEffect, useState, type ReactNode } from "react"
import { Animated, Easing, StyleSheet, View } from "react-native"

import { useReduceMotion } from "../../hooks/useReduceMotion"

export const PULSE_CYCLE_MS = 1000
export const PULSE_SCALE = 1.06
/** The pulse takes this part of each cycle, and the rest holds still. */
const PULSE_SPAN = 0.6
const CURVE_POINTS = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]

/** The scale at each point of the cycle: one smooth swell, then rest. A
 *  looped sequence freezes on Fabric, so one looped timing carries the shape. */
function pulseScale(progress: Animated.Value) {
  return progress.interpolate({
    inputRange: [...CURVE_POINTS.map((t) => t * PULSE_SPAN), 1],
    outputRange: [
      ...CURVE_POINTS.map((t) => 1 + (PULSE_SCALE - 1) * Math.sin(Math.PI * t)),
      1,
    ],
  })
}

export function Pulse({ children }: { children: ReactNode }) {
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
    loop.start()
    return () => loop.stop()
  }, [progress, reduceMotion])

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

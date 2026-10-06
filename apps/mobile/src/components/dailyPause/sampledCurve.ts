import type { Animated } from "react-native"

/** Nine points on a curve. The native driver rejects an `easing` key in an
 *  interpolation, so a curve rides in the ranges as sample points instead. */
export const CURVE_POINTS: readonly number[] = [
  0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1,
]

type SampledCurve = {
  fromMs: number
  spanMs: number
  /** The length of the 0-to-1 clock. */
  totalMs: number
  /** The value at each point, from 0 (the start) to 1 (the end). */
  curve: (t: number) => number
  points?: readonly number[]
}

/** `curve` from `fromMs` to `fromMs + spanMs` of a clock that runs from 0 to
 *  1 over `totalMs`, held at its first and last values outside that span. */
export function sampledCurve(
  progress: Animated.Value,
  { fromMs, spanMs, totalMs, curve, points = CURVE_POINTS }: SampledCurve,
): Animated.AnimatedInterpolation<number> {
  return progress.interpolate({
    inputRange: points.map((t) => (fromMs + t * spanMs) / totalMs),
    outputRange: points.map((t) => curve(t)),
    extrapolate: "clamp",
  })
}

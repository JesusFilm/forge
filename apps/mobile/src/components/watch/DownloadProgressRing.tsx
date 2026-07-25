import { useEffect, useRef, type ReactNode } from "react"
import { Animated, Easing, StyleSheet, View } from "react-native"

/**
 * Determinate progress ring drawn WITHOUT react-native-svg so it hot-reloads on
 * the existing dev build (svg would force a native rebuild). Two half-disc "pie"
 * layers pivoted via `transformOrigin`; `cutoutColor` MUST match `BG_COLOR`.
 *
 * Native progress events land ~once per second (engine `progressInterval`), so
 * mapping `progress` straight to rotation makes the arc teleport each tick. An
 * `Animated.Value` tweens between values (native-driver rotate) so the fill glides.
 */
export type DownloadProgressRingProps = {
  size: number
  strokeWidth: number
  /** 0..1 (clamped). */
  progress: number
  /** Filled-arc colour. */
  color: string
  /** Unfilled-track colour. */
  trackColor: string
  /** Opaque colour punched into the centre to form the ring — match the bg. */
  cutoutColor: string
  /**
   * Tween duration between progress ticks. Defaults to the ~1s native progress
   * cadence so the fill moves at a near-constant rate instead of stepping.
   */
  animationDurationMs?: number
  children?: ReactNode
}

export function DownloadProgressRing({
  size,
  strokeWidth,
  progress,
  color,
  trackColor,
  cutoutColor,
  animationDurationMs = 1000,
  children,
}: DownloadProgressRingProps) {
  const radius = size / 2
  const clamped = Math.max(0, Math.min(1, progress))
  const inner = Math.max(0, size - strokeWidth * 2)

  // Persist across renders so a re-render (new progress) resumes from the arc's
  // current on-screen angle rather than snapping. Seeded to the first value so
  // the ring appears at its real progress without an intro sweep.
  const anim = useRef(new Animated.Value(clamped)).current
  useEffect(() => {
    const animation = Animated.timing(anim, {
      toValue: clamped,
      duration: animationDurationMs,
      easing: Easing.linear,
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [anim, clamped, animationDurationMs])

  // Piecewise-linear rotations reproducing the static geometry: each half spins
  // from -180deg (outside its clip = empty) to 0deg (inside = filled). The right
  // half fills over 0–50%, the left over 50–100%.
  const rightRotate = anim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ["-180deg", "0deg", "0deg"],
    extrapolate: "clamp",
  })
  const leftRotate = anim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ["-180deg", "-180deg", "0deg"],
    extrapolate: "clamp",
  })

  return (
    <View style={[styles.root, { width: size, height: size }]}>
      <View
        style={[
          styles.track,
          {
            width: size,
            height: size,
            borderRadius: radius,
            borderWidth: strokeWidth,
            borderColor: trackColor,
          },
        ]}
      />

      {/* Right half — fills 0–50% clockwise from the top. */}
      <View
        style={[styles.clip, { left: radius, width: radius, height: size }]}
      >
        <Animated.View
          style={{
            width: radius,
            height: size,
            borderTopRightRadius: radius,
            borderBottomRightRadius: radius,
            backgroundColor: color,
            transformOrigin: "0% 50%",
            transform: [{ rotate: rightRotate }],
          }}
        />
      </View>

      {/* Left half — fills 50–100% clockwise to the top. */}
      <View style={[styles.clip, { left: 0, width: radius, height: size }]}>
        <Animated.View
          style={{
            width: radius,
            height: size,
            borderTopLeftRadius: radius,
            borderBottomLeftRadius: radius,
            backgroundColor: color,
            transformOrigin: "100% 50%",
            transform: [{ rotate: leftRotate }],
          }}
        />
      </View>

      {/* Punch the centre to leave a stroke-width ring. */}
      <View
        style={{
          position: "absolute",
          width: inner,
          height: inner,
          borderRadius: inner / 2,
          backgroundColor: cutoutColor,
        }}
      />

      {children != null && <View style={styles.center}>{children}</View>}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { alignItems: "center", justifyContent: "center" },
  track: { position: "absolute" },
  clip: { position: "absolute", top: 0, overflow: "hidden" },
  center: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
})

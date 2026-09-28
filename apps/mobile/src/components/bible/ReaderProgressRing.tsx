import { useEffect, useState, type ReactNode } from "react"
import { Animated, Easing, StyleSheet, View } from "react-native"

import { clamp } from "../../lib/scrubber"

/** Progress events can come fast; a short glide keeps the arc smooth. */
export const RING_TWEEN_MS = 300

export type ReaderProgressRingProps = {
  size: number
  strokeWidth: number
  /** 0 to 1; clamped. */
  progress: number
  color: string
  trackColor: string
  children?: ReactNode
}

// The reader's download ring (owner, 2026-09-28), after the watch page's
// DownloadProgressRing. That ring punches its center with an opaque disc; the
// reader's glass button has no opaque color, so this ring draws only its line.
export function ReaderProgressRing({
  size,
  strokeWidth,
  progress,
  color,
  trackColor,
  children,
}: ReaderProgressRingProps) {
  const radius = size / 2
  const value = clamp(progress, 0, 1)
  const [anim] = useState(() => new Animated.Value(value))
  useEffect(() => {
    const animation = Animated.timing(anim, {
      toValue: value,
      duration: RING_TWEEN_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [anim, value])

  // A circle with its top and right borders colored draws a half ring from
  // 10:30 to 4:30; turned 45deg it is the right half. Each clip shows the
  // half ring only while it turns into its own side of the ring.
  const rightTurn = anim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ["-135deg", "45deg", "45deg"],
    extrapolate: "clamp",
  })
  const leftTurn = anim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ["45deg", "45deg", "225deg"],
    extrapolate: "clamp",
  })
  const circle = {
    width: size,
    height: size,
    borderRadius: radius,
    borderWidth: strokeWidth,
  }
  const halfRing = {
    ...circle,
    borderTopColor: color,
    borderRightColor: color,
    borderBottomColor: "transparent",
    borderLeftColor: "transparent",
  }

  return (
    <View style={[styles.root, { width: size, height: size }]}>
      <View
        style={[styles.layer, circle, { borderColor: trackColor }]}
        testID="reader-progress-ring-track"
      />
      <View
        style={[styles.clip, { left: radius, width: radius, height: size }]}
      >
        <Animated.View
          testID="reader-progress-ring-right"
          style={[
            styles.layer,
            halfRing,
            { left: -radius, transform: [{ rotate: rightTurn }] },
          ]}
        />
      </View>
      <View style={[styles.clip, { left: 0, width: radius, height: size }]}>
        <Animated.View
          testID="reader-progress-ring-left"
          style={[
            styles.layer,
            halfRing,
            { left: 0, transform: [{ rotate: leftTurn }] },
          ]}
        />
      </View>
      {children != null && <View style={styles.center}>{children}</View>}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { alignItems: "center", justifyContent: "center" },
  layer: { position: "absolute", top: 0 },
  clip: { position: "absolute", top: 0, overflow: "hidden" },
  center: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
})

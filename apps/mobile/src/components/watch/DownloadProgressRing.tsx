import { type ReactNode } from "react"
import { StyleSheet, View } from "react-native"

/**
 * Determinate progress ring drawn WITHOUT react-native-svg so it hot-reloads on
 * the existing dev build (svg would force a native rebuild). Two solid half-disc
 * "pie" layers pivoted via `transformOrigin` with a punched centre disc.
 *
 * Geometry: right half 0–50% clockwise from 12 o'clock, left half 50–100%.
 * `cutoutColor` MUST match the surface behind the ring (`BG_COLOR`) so the
 * punched centre reads as transparent.
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
  children?: ReactNode
}

export function DownloadProgressRing({
  size,
  strokeWidth,
  progress,
  color,
  trackColor,
  cutoutColor,
  children,
}: DownloadProgressRingProps) {
  const radius = size / 2
  const clamped = Math.max(0, Math.min(1, progress))
  const deg = clamped * 360
  // Each half rotates from -180deg (fully outside its clip = empty) to 0deg
  // (fully inside its clip = filled). The right half handles the first 180deg.
  const rightRotate = Math.min(deg, 180) - 180
  const leftRotate = Math.max(deg - 180, 0) - 180
  const inner = Math.max(0, size - strokeWidth * 2)

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
        <View
          style={{
            width: radius,
            height: size,
            borderTopRightRadius: radius,
            borderBottomRightRadius: radius,
            backgroundColor: color,
            transformOrigin: "0% 50%",
            transform: [{ rotate: `${rightRotate}deg` }],
          }}
        />
      </View>

      {/* Left half — fills 50–100% clockwise to the top. */}
      <View style={[styles.clip, { left: 0, width: radius, height: size }]}>
        <View
          style={{
            width: radius,
            height: size,
            borderTopLeftRadius: radius,
            borderBottomLeftRadius: radius,
            backgroundColor: color,
            transformOrigin: "100% 50%",
            transform: [{ rotate: `${leftRotate}deg` }],
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

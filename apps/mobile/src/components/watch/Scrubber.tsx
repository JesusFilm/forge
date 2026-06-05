import { useRef, useState } from "react"
import {
  PanResponder,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from "react-native"

import { ACCENT } from "../../lib/color"
import { clamp, fractionToTime, progressFraction } from "../../lib/scrubber"

type ScrubberProps = {
  currentTime: number
  duration: number
  /** Commit a seek (drag release). */
  onSeek: (time: number) => void
  /** Drag lifecycle: active=true with the preview time on start/move,
   *  active=false on release/terminate. Lets the parent suppress its poll and
   *  show the dragged time live. */
  onScrubChange?: (active: boolean, previewTime: number | null) => void
}

const THUMB = 14

/**
 * Draggable seek bar (built-in PanResponder — react-native-gesture-handler is
 * forbidden under Expo Go).
 *
 * The fraction is computed from the gesture's ABSOLUTE screen X minus the
 * track's measured left edge — NOT `nativeEvent.locationX`, which is relative
 * to whichever child view (thumb/fill) is under the finger and under-reports as
 * the thumb moves, making the thumb lag behind the finger. `measureInWindow`
 * keeps the track origin/width current across layout + rotation changes.
 */
export function Scrubber({
  currentTime,
  duration,
  onSeek,
  onScrubChange,
}: ScrubberProps) {
  const containerRef = useRef<View>(null)
  const trackRef = useRef({ x: 0, width: 0 })
  // Last fraction from grant/move. Release seeks to THIS, not a fresh read of
  // gestureState.moveX — on a tap (no move) moveX is 0, which would seek to 0.
  const lastFractionRef = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [dragFraction, setDragFraction] = useState(0)

  // Mirror live props into refs so the PanResponder (created once) reads
  // current values instead of the closure captured on first render.
  const durationRef = useRef(duration)
  durationRef.current = duration
  const onSeekRef = useRef(onSeek)
  onSeekRef.current = onSeek
  const onScrubChangeRef = useRef(onScrubChange)
  onScrubChangeRef.current = onScrubChange

  const measure = () => {
    containerRef.current?.measureInWindow((x, _y, width) => {
      trackRef.current = { x, width }
    })
  }

  const fractionFromAbsX = (absX: number) => {
    const { x, width } = trackRef.current
    return clamp(width > 0 ? (absX - x) / width : 0, 0, 1)
  }

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      // Only capture once the gesture is clearly horizontal, so a vertical
      // swipe scrolls the page instead of scrubbing.
      onMoveShouldSetPanResponderCapture: (
        _e: GestureResponderEvent,
        g: PanResponderGestureState,
      ) => Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > 2,
      onPanResponderGrant: (
        _e: GestureResponderEvent,
        g: PanResponderGestureState,
      ) => {
        // Re-measure in case the layout changed (fullscreen/rotation) without a
        // fresh onLayout, then map from the initial touch X.
        measure()
        const f = fractionFromAbsX(g.x0)
        lastFractionRef.current = f
        setDragging(true)
        setDragFraction(f)
        onScrubChangeRef.current?.(true, fractionToTime(f, durationRef.current))
      },
      onPanResponderMove: (
        _e: GestureResponderEvent,
        g: PanResponderGestureState,
      ) => {
        const f = fractionFromAbsX(g.moveX)
        lastFractionRef.current = f
        setDragFraction(f)
        onScrubChangeRef.current?.(true, fractionToTime(f, durationRef.current))
      },
      onPanResponderRelease: () => {
        // Seek to the last grant/move fraction — NOT a fresh moveX read, which
        // is 0 on a tap and would reset to the start.
        const t = fractionToTime(lastFractionRef.current, durationRef.current)
        setDragging(false)
        onScrubChangeRef.current?.(false, null)
        if (t != null) onSeekRef.current(t)
      },
      onPanResponderTerminate: () => {
        setDragging(false)
        onScrubChangeRef.current?.(false, null)
      },
    }),
  ).current

  const fraction = dragging
    ? dragFraction
    : progressFraction(currentTime, duration)
  const pct = `${fraction * 100}%` as const

  return (
    <View
      ref={containerRef}
      style={styles.hitArea}
      onLayout={measure}
      accessibilityRole="adjustable"
      accessibilityLabel="Seek bar"
      {...pan.panHandlers}
    >
      <View style={styles.track}>
        <View style={[styles.fill, { width: pct }]} />
      </View>
      <View
        style={[
          styles.thumb,
          dragging && styles.thumbActive,
          { left: pct, marginLeft: -THUMB / 2 },
        ]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  // Tall, transparent hit area for an easy grab; the visible track is thin.
  hitArea: {
    height: 28,
    justifyContent: "center",
    marginBottom: 4,
  },
  track: {
    height: 3,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    borderRadius: 1.5,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    backgroundColor: ACCENT,
    borderRadius: 1.5,
  },
  thumb: {
    position: "absolute",
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: ACCENT,
    top: 14 - THUMB / 2,
  },
  thumbActive: {
    transform: [{ scale: 1.4 }],
  },
})

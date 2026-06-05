import { useRef, useState } from "react"
import {
  PanResponder,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
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
 * Draggable seek bar. Uses the built-in PanResponder (react-native-gesture-
 * handler is forbidden under Expo Go) with a horizontal-intent capture gate so
 * vertical scrolls fall through to the page while horizontal drags scrub. The
 * scrub-vs-scroll arbitration is verified in the simulator (R19); once the
 * player is pinned outside the ScrollView (U5) the contention largely
 * disappears.
 */
export function Scrubber({
  currentTime,
  duration,
  onSeek,
  onScrubChange,
}: ScrubberProps) {
  const widthRef = useRef(0)
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

  const fractionFromX = (x: number) =>
    clamp(widthRef.current > 0 ? x / widthRef.current : 0, 0, 1)

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      // Only capture once the gesture is clearly horizontal, so a vertical
      // swipe scrolls the page instead of scrubbing.
      onMoveShouldSetPanResponderCapture: (
        _e: GestureResponderEvent,
        g: PanResponderGestureState,
      ) => Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > 2,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        const f = fractionFromX(e.nativeEvent.locationX)
        setDragging(true)
        setDragFraction(f)
        onScrubChangeRef.current?.(true, fractionToTime(f, durationRef.current))
      },
      onPanResponderMove: (e: GestureResponderEvent) => {
        const f = fractionFromX(e.nativeEvent.locationX)
        setDragFraction(f)
        onScrubChangeRef.current?.(true, fractionToTime(f, durationRef.current))
      },
      onPanResponderRelease: (e: GestureResponderEvent) => {
        const f = fractionFromX(e.nativeEvent.locationX)
        const t = fractionToTime(f, durationRef.current)
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
      style={styles.hitArea}
      onLayout={(e: LayoutChangeEvent) => {
        widthRef.current = e.nativeEvent.layout.width
      }}
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

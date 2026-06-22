import { useEffect, useRef, useState } from "react"
import {
  Animated,
  PanResponder,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PanResponderGestureState,
} from "react-native"

import { ACCENT, TEXT_ON_OVERLAY, hexToRgba } from "../../lib/color"
import {
  applySkip,
  clamp,
  fractionToTime,
  progressFraction,
} from "../../lib/scrubber"
import { SKIP_SECONDS } from "../../lib/tapSeek"

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
const TRACK_HEIGHT = 3
const HIT_HEIGHT = 44

/**
 * Draggable seek bar (built-in PanResponder — gesture-handler is forbidden under Expo Go).
 *
 * Position uses an `Animated.Value` (0..1) updated via `setValue`, NOT state, so
 * a drag pushes straight to native without re-rendering this or the parent —
 * setState-per-frame janked the low-end Android targets (parent's preview
 * callback is throttled to whole seconds for the same reason).
 *
 * Fraction is gesture ABSOLUTE screen X minus the track's measured left edge,
 * not `nativeEvent.locationX` (relative to the child under the finger, so it
 * under-reports as the thumb moves); `measureInWindow` tracks origin/width across layout/rotation.
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
  // Track width in state so the thumb's translateX interpolation has a concrete
  // output range; set on layout/rotation only, never per drag frame.
  const [trackWidth, setTrackWidth] = useState(0)

  // Native-friendly position (0..1) and thumb grow-on-grab scale. Both updated
  // via setValue so the gesture never triggers a React render.
  const progress = useRef(new Animated.Value(0)).current
  const thumbScale = useRef(new Animated.Value(1)).current

  // Mirror live props into refs so the PanResponder (created once) reads
  // current values instead of the closure captured on first render.
  const durationRef = useRef(duration)
  durationRef.current = duration
  const onSeekRef = useRef(onSeek)
  onSeekRef.current = onSeek
  const onScrubChangeRef = useRef(onScrubChange)
  onScrubChangeRef.current = onScrubChange
  const draggingRef = useRef(false)
  // Last whole second pushed to the parent label, so the preview callback fires
  // at most ~once per displayed second instead of once per frame.
  const lastWholeSecondRef = useRef(-1)

  const measure = () => {
    containerRef.current?.measureInWindow((x, _y, width) => {
      trackRef.current = { x, width }
    })
  }

  const fractionFromAbsX = (absX: number) => {
    const { x, width } = trackRef.current
    return clamp(width > 0 ? (absX - x) / width : 0, 0, 1)
  }

  // Keep the position synced to playback whenever NOT dragging. setValue (not
  // setState) so the 500ms poll advancing currentTime never re-renders us.
  useEffect(() => {
    if (draggingRef.current) return
    progress.setValue(progressFraction(currentTime, duration))
  }, [currentTime, duration, progress])

  // Emit the preview time to the parent, but only when the displayed (whole)
  // second changes — the label shows mm:ss, so sub-second emits are wasted
  // setState in the parent.
  const emitPreviewThrottled = (f: number) => {
    const t = fractionToTime(f, durationRef.current)
    if (t == null) return
    const whole = Math.floor(t)
    if (whole === lastWholeSecondRef.current) return
    lastWholeSecondRef.current = whole
    onScrubChangeRef.current?.(true, t)
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
        draggingRef.current = true
        progress.setValue(f)
        thumbScale.setValue(1.4)
        // Always emit the start so the parent suppresses its poll immediately.
        const t = fractionToTime(f, durationRef.current)
        lastWholeSecondRef.current = t == null ? -1 : Math.floor(t)
        onScrubChangeRef.current?.(true, t)
      },
      onPanResponderMove: (
        _e: GestureResponderEvent,
        g: PanResponderGestureState,
      ) => {
        const f = fractionFromAbsX(g.moveX)
        lastFractionRef.current = f
        progress.setValue(f) // native update, no React render
        emitPreviewThrottled(f)
      },
      onPanResponderRelease: () => {
        // Seek to the last grant/move fraction — NOT a fresh moveX read, which
        // is 0 on a tap and would reset to the start.
        const t = fractionToTime(lastFractionRef.current, durationRef.current)
        draggingRef.current = false
        thumbScale.setValue(1)
        onScrubChangeRef.current?.(false, null)
        if (t != null) onSeekRef.current(t)
      },
      onPanResponderTerminate: () => {
        draggingRef.current = false
        thumbScale.setValue(1)
        onScrubChangeRef.current?.(false, null)
      },
    }),
  ).current

  // 0..1 → [0, trackWidth] px. Rebuilt when the track is (re)measured, not per
  // frame; the thumb is centered on the position via the static marginLeft.
  const thumbTranslateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, trackWidth],
  })

  return (
    <View
      ref={containerRef}
      style={styles.hitArea}
      onLayout={(e: LayoutChangeEvent) => {
        measure()
        setTrackWidth(e.nativeEvent.layout.width)
      }}
      // accessible MUST be explicit: iOS doesn't promote a plain View with an
      // accessibilityRole (unlike Pressable), so without it the adjustable role
      // + actions never reach VoiceOver/Switch Control — bar silently unreachable.
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Seek bar"
      // Drag-only by touch; expose increment/decrement (swipe up/down → ±10s,
      // matching skip buttons) so VoiceOver/Switch Control/idb can operate it.
      // `now` reads playback position (props), what a screen-reader user tracks.
      accessibilityValue={{
        min: 0,
        max: 100,
        now: Math.round(progressFraction(currentTime, duration) * 100),
      }}
      // Declare the actions explicitly so TalkBack (Android — the primary
      // audience) registers them; iOS infers them from the adjustable role.
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => {
        const delta =
          e.nativeEvent.actionName === "increment"
            ? SKIP_SECONDS
            : -SKIP_SECONDS
        const target = applySkip(currentTime, delta, duration)
        if (target != null) onSeek(target)
      }}
      {...pan.panHandlers}
    >
      <View style={styles.track}>
        <Animated.View
          style={[styles.fill, { transform: [{ scaleX: progress }] }]}
        />
      </View>
      {/* Render thumb only once measured: at trackWidth 0 (every chrome reveal
          remounts the Scrubber) translateX collapses to [0,0], so the thumb sits
          left while the fill shows the real position — a one-frame desync. */}
      {trackWidth > 0 && (
        <Animated.View
          style={[
            styles.thumb,
            {
              transform: [
                { translateX: thumbTranslateX },
                { scale: thumbScale },
              ],
            },
          ]}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  // Tall (44px), transparent hit area for an easy, accessible grab; the visible
  // track is thin and vertically centered within it.
  hitArea: {
    height: HIT_HEIGHT,
    justifyContent: "center",
  },
  track: {
    height: TRACK_HEIGHT,
    backgroundColor: hexToRgba(TEXT_ON_OVERLAY, 0.3),
    borderRadius: TRACK_HEIGHT / 2,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    width: "100%",
    backgroundColor: ACCENT,
    // Scale from the left edge so scaleX = fraction fills left-to-right.
    transformOrigin: "left center",
  },
  thumb: {
    position: "absolute",
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: ACCENT,
    // Vertically center on the track; horizontally center on the position.
    top: (HIT_HEIGHT - THUMB) / 2,
    left: 0,
    marginLeft: -THUMB / 2,
  },
})

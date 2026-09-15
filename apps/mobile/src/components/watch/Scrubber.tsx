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
  mayStartScrub,
  progressFraction,
  thumbOutputRange,
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
  /** Dock the bar on the player's bottom edge: the visible track bottom-aligns
   *  inside the hit area (which keeps its full height by extending upward), and
   *  the thumb's travel insets by its own radius so it never half-leaves the
   *  screen at 0% and 100%. The two move together — a bottom-aligned track with
   *  centered thumb travel is not a state this component supports. */
  flush?: boolean
  /** Width (px from the screen's left edge) the OS back-swipe owns. A touch
   *  starting inside it is declined so a page-dismiss drag is never half-read
   *  as a scrub. 0 where no pop can start (fullscreen). See lib/backSwipe.ts. */
  edgeGuardWidth?: number
}

const THUMB = 14
const TRACK_HEIGHT = 3
/** The transparent grab area's height. Exported so the caption above it
 *  can clear the TOUCH target, not just the thin visible track. */
export const SCRUBBER_HIT_HEIGHT = 44

/**
 * Draggable seek bar (built-in PanResponder — gesture-handler is forbidden under Expo Go). Position uses an
 * `Animated.Value` (0..1) via `setValue`, NOT state, so a drag pushes straight to native without re-rendering
 * (setState-per-frame janked low-end Android); fraction is absolute screen X minus the track's left edge.
 */
export function Scrubber({
  currentTime,
  duration,
  onSeek,
  onScrubChange,
  flush = false,
  edgeGuardWidth = 0,
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
  // Read at gesture time, not closure-captured: the PanResponder is built once
  // but the guard width changes with fullscreen.
  const edgeGuardRef = useRef(edgeGuardWidth)
  edgeGuardRef.current = edgeGuardWidth
  // Where the current touch began, in screen coordinates. PanResponder's
  // gestureState.x0 is only assigned at GRANT and is 0 before then, so the
  // move-phase gate — which runs precisely while nothing has granted — cannot
  // use it to tell where the finger started.
  const touchStartXRef = useRef(0)
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
      // Observer only: records the origin for the move gate below. Returning
      // true here would capture every touch on the player.
      onStartShouldSetPanResponderCapture: (e: GestureResponderEvent) => {
        touchStartXRef.current = e.nativeEvent.pageX
        return false
      },
      onStartShouldSetPanResponder: (e: GestureResponderEvent) =>
        mayStartScrub(e.nativeEvent.pageX, edgeGuardRef.current),
      // Only capture once the gesture is clearly horizontal, so a vertical
      // swipe scrolls the page instead of scrubbing — and never for a drag
      // that began in the strip the back-swipe owns.
      onMoveShouldSetPanResponderCapture: (
        _e: GestureResponderEvent,
        g: PanResponderGestureState,
      ) =>
        mayStartScrub(touchStartXRef.current, edgeGuardRef.current) &&
        Math.abs(g.dx) > Math.abs(g.dy) &&
        Math.abs(g.dx) > 2,
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

  // 0..1 → px. Rebuilt when the track is (re)measured, not per frame; the thumb
  // is centered on the position via the static marginLeft.
  const thumbTranslateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: thumbOutputRange(trackWidth, THUMB, flush),
  })

  return (
    <View
      ref={containerRef}
      style={[styles.hitArea, flush && styles.hitAreaBottom]}
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
            flush && styles.thumbBottom,
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
    height: SCRUBBER_HIT_HEIGHT,
    justifyContent: "center",
  },
  hitAreaBottom: {
    justifyContent: "flex-end",
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
    top: (SCRUBBER_HIT_HEIGHT - THUMB) / 2,
    left: 0,
    marginLeft: -THUMB / 2,
  },
  // Centered on a bottom-aligned track. The track touches the player's edge, so
  // the lower half draws past it — the caller must not clip its overflow.
  thumbBottom: {
    top: SCRUBBER_HIT_HEIGHT - TRACK_HEIGHT / 2 - THUMB / 2,
  },
})

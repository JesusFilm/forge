import { useCallback, useEffect, useRef, useState } from "react"
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PanResponderGestureState,
} from "react-native"
import type { VideoPlayer } from "expo-video"

import { useTypography } from "../../hooks/useTypography"
import { useT } from "../../i18n/useT"
import { BLACK, TEXT_ON_OVERLAY, hexToRgba } from "../../lib/color"
import { readOr } from "../../lib/explore/playerRead"
import type { ClipWindow } from "../../lib/explore/types"
import {
  clamp,
  fractionToTime,
  progressFraction,
  thumbOutputRange,
} from "../../lib/scrubber"

type ClipProgressBarProps = {
  /** The active feed player. */
  player: VideoPlayer
  clipWindow: ClipWindow
  /** Seeks the active clip. The bar never writes the player's time itself. */
  onSeek: (seconds: number) => void
  /** The clip loads under its veil, so the player's time is not yet its own. */
  veiled: boolean
}

/**
 * One screen-reader step. A clip can be 25 s long, so the watch page's 10 s
 * step is too coarse.
 */
const CLIP_STEP_SECONDS = 5

const HIT_HEIGHT = 44
const TRACK_HEIGHT = 3
const THUMB = 12
/** A drag this far sideways is a scrub, and the pager may no longer take it. */
const SCRUB_LOCK_DX = 8

/** m:ss for a place in a clip, which is never an hour long. */
function clipClock(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`
}

/** The pill above a scrub: "0:12 / 0:48". Digits and a slash only, so it stays
 *  out of the catalog: the translator rejects a message that equals English. */
function scrubTime(elapsed: number, length: number): string {
  return `${clipClock(elapsed)} / ${clipClock(length)}`
}

function lengthOf({ startSeconds, endSeconds }: ClipWindow): number {
  return Math.max(endSeconds - startSeconds, 0)
}

/** Seconds into the clip for a time in the full asset, inside the window. */
function clipElapsed(time: number, clipWindow: ClipWindow): number {
  if (!Number.isFinite(time)) return 0
  return clamp(time - clipWindow.startSeconds, 0, lengthOf(clipWindow))
}

/** The time in the full asset at a 0..1 point of the clip. */
function clipTimeAt(fraction: number, clipWindow: ClipWindow): number {
  return (
    clipWindow.startSeconds +
    (fractionToTime(fraction, lengthOf(clipWindow)) ?? 0)
  )
}

function readTime(player: VideoPlayer): number {
  return readOr(() => player.currentTime ?? Number.NaN, Number.NaN)
}

/**
 * The clip's own progress bar (R12): 0 to the clip length, never the full
 * video. A leaf that reads the player's time itself, so a time update renders
 * only this bar and never the overlay or the feed (KTD22).
 */
export function ClipProgressBar({
  player,
  clipWindow,
  onSeek,
  veiled,
}: ClipProgressBarProps) {
  const typography = useTypography()
  const t = useT("Explore")
  const { startSeconds, endSeconds } = clipWindow
  const length = lengthOf(clipWindow)

  // Whole seconds only, for the screen reader: at 4 updates a second, the bar
  // then renders once a second, and the fill moves through setValue.
  const [elapsed, setElapsed] = useState(() =>
    Math.floor(clipElapsed(readTime(player), clipWindow)),
  )
  const [trackWidth, setTrackWidth] = useState(0)
  const progress = useRef(new Animated.Value(0)).current

  // The PanResponder is built once, so its handlers read these refs.
  const playerRef = useRef(player)
  playerRef.current = player
  const windowRef = useRef(clipWindow)
  windowRef.current = clipWindow
  const onSeekRef = useRef(onSeek)
  onSeekRef.current = onSeek
  const widthRef = useRef(0)
  const grantXRef = useRef(0)
  const fractionRef = useRef(0)
  const draggingRef = useRef(false)
  // The thumb shows only during a drag (owner, 2026-09-27): the whole strip
  // takes the touch, so at rest the fill alone marks the place.
  const [dragging, setDragging] = useState(false)
  const lockedRef = useRef(false)
  // The pill above a drag names the place it reaches (owner, 2026-09-27).
  // Whole seconds, so a drag renders the bar once a second, not every frame.
  const [scrubSeconds, setScrubSeconds] = useState(0)
  const [pillWidth, setPillWidth] = useState(0)

  // Both read only refs and stable values, so the PanResponder built on the
  // first render calls the same functions every later render would.
  const show = useCallback(
    (time: number) => {
      const bounds = windowRef.current
      const seconds = clipElapsed(time, bounds)
      progress.setValue(progressFraction(seconds, lengthOf(bounds)))
      setElapsed(Math.floor(seconds))
    },
    [progress],
  )

  const seekTo = useCallback(
    (time: number) => {
      onSeekRef.current(time)
      show(time)
    },
    [show],
  )

  useEffect(() => {
    // Under the veil the player can still hold the last clip's time, which
    // clamps to a full or empty bar. The clip has not started, so show its start.
    if (veiled) {
      show(startSeconds)
      return
    }
    show(readTime(player))
    const sub = player.addListener("timeUpdate", ({ currentTime }) => {
      if (!draggingRef.current) show(currentTime)
    })
    return () => sub.remove()
  }, [player, startSeconds, endSeconds, show, veiled])

  const fractionAt = (x: number) =>
    widthRef.current > 0 ? clamp(x / widthRef.current, 0, 1) : 0

  const scrubTo = (fraction: number) => {
    fractionRef.current = fraction
    progress.setValue(fraction)
    setScrubSeconds(Math.floor(fraction * lengthOf(windowRef.current)))
  }

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        draggingRef.current = true
        setDragging(true)
        lockedRef.current = false
        grantXRef.current = e.nativeEvent.locationX
        scrubTo(fractionAt(grantXRef.current))
      },
      onPanResponderMove: (
        _e: GestureResponderEvent,
        g: PanResponderGestureState,
      ) => {
        if (Math.abs(g.dx) > SCRUB_LOCK_DX && Math.abs(g.dx) > Math.abs(g.dy)) {
          lockedRef.current = true
        }
        scrubTo(fractionAt(grantXRef.current + g.dx))
      },
      // A vertical swipe that starts on the bar still belongs to the pager.
      onPanResponderTerminationRequest: () => !lockedRef.current,
      onPanResponderRelease: () => {
        draggingRef.current = false
        setDragging(false)
        seekTo(clipTimeAt(fractionRef.current, windowRef.current))
      },
      onPanResponderTerminate: () => {
        draggingRef.current = false
        setDragging(false)
        show(readTime(playerRef.current))
      },
    }),
  ).current

  const handleLayout = (e: LayoutChangeEvent) => {
    widthRef.current = e.nativeEvent.layout.width
    setTrackWidth(e.nativeEvent.layout.width)
  }

  const handleAction = (e: AccessibilityActionEvent) => {
    const delta =
      e.nativeEvent.actionName === "increment"
        ? CLIP_STEP_SECONDS
        : -CLIP_STEP_SECONDS
    const now = readTime(playerRef.current)
    if (!Number.isFinite(now)) return
    seekTo(clamp(now + delta, startSeconds, endSeconds))
  }

  const total = Math.round(length)
  const thumbX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: thumbOutputRange(trackWidth, THUMB, false),
  })
  // The pill centres on the drag, and stops at the bar's two ends.
  const half = trackWidth > 0 ? pillWidth / 2 / trackWidth : 0
  const pillX =
    pillWidth > 0 && half < 0.5
      ? progress.interpolate({
          inputRange: [0, half, 1 - half, 1],
          outputRange: [0, 0, trackWidth - pillWidth, trackWidth - pillWidth],
          extrapolate: "clamp",
        })
      : 0

  return (
    <View
      testID="clip-progress-bar"
      style={styles.hitArea}
      onLayout={handleLayout}
      // iOS promotes a plain View with a role only when `accessible` is set.
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={t("progressAriaLabel")}
      accessibilityValue={{
        min: 0,
        max: total,
        now: elapsed,
        text: t("progressAriaValue", { elapsed, length: total }),
      }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={handleAction}
      {...pan.panHandlers}
    >
      <View style={styles.track} pointerEvents="none">
        <Animated.View
          style={[styles.fill, { transform: [{ scaleX: progress }] }]}
        />
      </View>
      {dragging && trackWidth > 0 && (
        <Animated.View
          testID="clip-progress-thumb"
          pointerEvents="none"
          style={[styles.thumb, { transform: [{ translateX: thumbX }] }]}
        />
      )}
      {dragging && trackWidth > 0 && (
        <Animated.View
          testID="clip-scrub-pill"
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onLayout={(e) => setPillWidth(Math.round(e.nativeEvent.layout.width))}
          style={[
            styles.pill,
            // Hidden for the one frame before its width is known.
            {
              opacity: pillWidth > 0 ? 1 : 0,
              transform: [{ translateX: pillX }],
            },
          ]}
        >
          <Text style={[styles.pillText, typography.caption]}>
            {scrubTime(scrubSeconds, total)}
          </Text>
        </Animated.View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  hitArea: {
    height: HIT_HEIGHT,
    marginHorizontal: 16,
    justifyContent: "center",
  },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: hexToRgba(TEXT_ON_OVERLAY, 0.35),
    overflow: "hidden",
  },
  // White, not the brand red: red on the scrim fails the 3:1 floor for a
  // control over a bright frame, and white clears it on any frame.
  fill: {
    height: "100%",
    width: "100%",
    backgroundColor: TEXT_ON_OVERLAY,
    transformOrigin: "left center",
  },
  thumb: {
    position: "absolute",
    top: (HIT_HEIGHT - THUMB) / 2,
    left: 0,
    width: THUMB,
    height: THUMB,
    marginLeft: -THUMB / 2,
    borderRadius: THUMB / 2,
    backgroundColor: TEXT_ON_OVERLAY,
  },
  pill: {
    position: "absolute",
    left: 0,
    bottom: HIT_HEIGHT / 2 + THUMB / 2 + 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: hexToRgba(BLACK, 0.75),
  },
  // Fixed-width digits, so the pill does not change width as the time runs.
  pillText: {
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
})

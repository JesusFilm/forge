import { useEffect, useRef, useState } from "react"
import {
  Animated,
  PanResponder,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PanResponderGestureState,
} from "react-native"
import type { VideoPlayer } from "expo-video"

import { TEXT_ON_OVERLAY, hexToRgba } from "../../lib/color"
import { EXPLORE_COPY } from "../../lib/explore/copy"
import type { ClipWindow } from "../../lib/explore/types"
import { clamp } from "../../lib/scrubber"

type ClipProgressBarProps = {
  /** The active feed player. Null outside the current slot: the bar rests at 0. */
  player: VideoPlayer | null
  clipWindow: ClipWindow
}

/** One screen-reader step. Clips run 10 to 30 s, so the watch page's 10 s is too coarse. */
export const CLIP_STEP_SECONDS = 5

const HIT_HEIGHT = 44
const TRACK_HEIGHT = 3
const THUMB = 12
/** A drag this far sideways is a scrub, and the pager may no longer take it. */
const SCRUB_LOCK_DX = 8

function lengthOf({ startSeconds, endSeconds }: ClipWindow): number {
  return Math.max(endSeconds - startSeconds, 0)
}

/** Seconds into the clip for a time in the full asset, inside the window. */
export function clipElapsed(time: number, clipWindow: ClipWindow): number {
  if (!Number.isFinite(time)) return 0
  return clamp(time - clipWindow.startSeconds, 0, lengthOf(clipWindow))
}

/** The time in the full asset at a 0..1 point of the clip. */
export function clipTimeAt(fraction: number, clipWindow: ClipWindow): number {
  return clipWindow.startSeconds + clamp(fraction, 0, 1) * lengthOf(clipWindow)
}

function readTime(player: VideoPlayer | null): number {
  try {
    return player?.currentTime ?? Number.NaN
  } catch {
    // A released player throws on property access.
    return Number.NaN
  }
}

/**
 * The clip's own progress bar (R12): 0 to the clip length, never the full
 * video. A leaf that reads the player's time itself, so a time update renders
 * only this bar and never the overlay or the feed (KTD22).
 */
export function ClipProgressBar({ player, clipWindow }: ClipProgressBarProps) {
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
  const widthRef = useRef(0)
  const grantXRef = useRef(0)
  const fractionRef = useRef(0)
  const draggingRef = useRef(false)
  const lockedRef = useRef(false)

  const show = (time: number) => {
    const bounds = windowRef.current
    const span = lengthOf(bounds)
    const seconds = clipElapsed(time, bounds)
    progress.setValue(span > 0 ? seconds / span : 0)
    setElapsed(Math.floor(seconds))
  }
  const showRef = useRef(show)
  showRef.current = show

  const seekTo = (time: number) => {
    const target = playerRef.current
    if (target == null) return
    target.currentTime = time
    showRef.current(time)
  }
  const seekRef = useRef(seekTo)
  seekRef.current = seekTo

  useEffect(() => {
    if (player == null) {
      progress.setValue(0)
      setElapsed(0)
      return
    }
    showRef.current(readTime(player))
    const sub = player.addListener("timeUpdate", ({ currentTime }) => {
      if (!draggingRef.current) showRef.current(currentTime)
    })
    return () => sub.remove()
  }, [player, startSeconds, endSeconds, progress])

  const fractionAt = (x: number) =>
    widthRef.current > 0 ? clamp(x / widthRef.current, 0, 1) : 0

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => playerRef.current != null,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        draggingRef.current = true
        lockedRef.current = false
        grantXRef.current = e.nativeEvent.locationX
        fractionRef.current = fractionAt(grantXRef.current)
        progress.setValue(fractionRef.current)
      },
      onPanResponderMove: (
        _e: GestureResponderEvent,
        g: PanResponderGestureState,
      ) => {
        if (Math.abs(g.dx) > SCRUB_LOCK_DX && Math.abs(g.dx) > Math.abs(g.dy)) {
          lockedRef.current = true
        }
        fractionRef.current = fractionAt(grantXRef.current + g.dx)
        progress.setValue(fractionRef.current)
      },
      // A vertical swipe that starts on the bar still belongs to the pager.
      onPanResponderTerminationRequest: () => !lockedRef.current,
      onPanResponderRelease: () => {
        draggingRef.current = false
        seekRef.current(clipTimeAt(fractionRef.current, windowRef.current))
      },
      onPanResponderTerminate: () => {
        draggingRef.current = false
        showRef.current(readTime(playerRef.current))
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
    outputRange: [0, Math.max(trackWidth, 0)],
  })

  return (
    <View
      testID="clip-progress-bar"
      style={styles.hitArea}
      onLayout={handleLayout}
      // iOS promotes a plain View with a role only when `accessible` is set.
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={EXPLORE_COPY.progressLabel}
      accessibilityValue={{
        min: 0,
        max: total,
        now: elapsed,
        text: EXPLORE_COPY.progressValue(elapsed, total),
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
      {trackWidth > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[styles.thumb, { transform: [{ translateX: thumbX }] }]}
        />
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
})

/**
 * The floating window's chrome, drag and accessibility (U7).
 *
 * It hosts no video view. The playback host owns the app's one view and
 * animates it into this window's frame (KTD17); this component draws over that
 * frame and contributes the controls, the drag, the ended and failed states,
 * and the accessibility surface.
 *
 * The drag value belongs to the host because the host owns the node the frame
 * geometry sits on. KTD5 forbids the native driver on that node, so the shrink
 * and the exit run on a separate wrapper the responder below never writes.
 *
 * `PlayerControls` is deliberately not reused: its inline branch docks a
 * full-width grab strip along the bottom edge that would fight this responder.
 */

import { useEffect, useMemo, useRef } from "react"
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
} from "react-native"
import { Image } from "expo-image"
import Ionicons from "@expo/vector-icons/Ionicons"

import { ACCENT, BLACK, TEXT_ON_OVERLAY, hexToRgba } from "../../lib/color"
import {
  ACCESSIBILITY_MIN_TARGET,
  allowedCorners,
  miniPlayerCornerFrame,
  snapToCorner,
  type MiniPlayerCorner,
  type MiniPlayerFrame,
  type MiniPlayerLayoutConfig,
} from "../../lib/miniPlayer/layout"
import type { MiniPlayerEndedCause } from "../../lib/miniPlayer/store"
import { progressFraction } from "../../lib/scrubber"
import { resolveImageUrl } from "../../lib/resolveImageUrl"

/** Travel before a touch reads as a drag rather than a tap. */
const DRAG_SLOP = 4

/** The glyph box stays small over a small window; the slop is what brings the
 *  TARGET up to the floor KTD6 reserves two of the window's width for. */
const CONTROL_SIZE = 34
const CONTROL_HIT_SLOP = (ACCESSIBILITY_MIN_TARGET - CONTROL_SIZE) / 2

/** Settle into the snapped corner. JS-driven — it writes the drag node. */
const SNAP_DURATION_MS = 180

/** R21's crossfade from the last frame to the thumbnail. */
export const ENDED_FADE_DURATION_MS = 320

export const MINI_PLAYER_DISMISS_LABEL = "Close the mini player"
export const MINI_PLAYER_FAILURE_TEXT = "Playback failed"

/**
 * R8: reach, describe and act. The controls overlay the video's top corners at
 * window scale, so every one of them is also an action here.
 */
export const MINI_PLAYER_ACCESSIBILITY_ACTIONS = [
  { name: "activate", label: "Open the full screen player" },
  { name: "playPause", label: "Play or pause" },
  { name: "moveToCorner", label: "Move to the next corner" },
  { name: "dismiss", label: MINI_PLAYER_DISMISS_LABEL },
] as const

export type MiniPlayerWindowProps = {
  /** The window's layout box, which is the DEFAULT corner. Every other corner
   *  is an offset from it, so a snap changes no layout and cannot flicker. */
  frame: MiniPlayerFrame
  layout: MiniPlayerLayoutConfig
  /** Host-owned: the host applies it to the node carrying the frame geometry. */
  drag: Animated.ValueXY
  corner: MiniPlayerCorner
  onCornerChange: (corner: MiniPlayerCorner) => void
  title: string
  posterUrl: string | null
  positionSeconds: number
  durationSeconds: number
  isPlaying: boolean
  /** Set once playback finished or the stream failed (R21, R22). */
  endedCause: MiniPlayerEndedCause | null
  /** One predicate for the chrome AND its tap target, released on a timer by
   *  the host so a shrink that never settles cannot strand the viewer. */
  ready: boolean
  /** The dismissal exit is running (R6). The window stays mounted through it
   *  but goes inert: dismiss and expand are adjacent taps, and a second tap
   *  landing mid-exit would push a route the exit then clears the session
   *  under. */
  exiting?: boolean
  onPlayPause: () => void
  onReplay: () => void
  onDismiss: () => void
  onExpand: () => void
  onEndedFadeComplete: () => void
}

export function MiniPlayerWindow({
  frame,
  layout,
  drag,
  corner,
  onCornerChange,
  title,
  posterUrl,
  positionSeconds,
  durationSeconds,
  isPlaying,
  endedCause,
  ready,
  exiting = false,
  onPlayPause,
  onReplay,
  onDismiss,
  onExpand,
  onEndedFadeComplete,
}: MiniPlayerWindowProps) {
  const failed = endedCause === "failure"
  const ended = endedCause != null

  // The responder is built once, so everything it reads lives in a ref.
  const frameRef = useRef(frame)
  frameRef.current = frame
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const cornerRef = useRef(corner)
  cornerRef.current = corner
  const onCornerChangeRef = useRef(onCornerChange)
  onCornerChangeRef.current = onCornerChange

  // Where the drag node actually is, tracked continuously so a touch that
  // lands mid-settle picks the gesture up from the rendered position.
  const liveRef = useRef({ x: 0, y: 0 })
  const grabRef = useRef({ x: 0, y: 0 })
  const settleRef = useRef<Animated.CompositeAnimation | null>(null)
  const controlTouchRef = useRef(false)

  useEffect(() => {
    // A listener never fires on add, and the host's drag survives this window's
    // remount (R11/KTD16 suppression), so seed from the occupied corner with the
    // host's own resting arithmetic or the first drag jumps back to the frame.
    const resting = miniPlayerCornerFrame(layoutRef.current, cornerRef.current)
    liveRef.current = {
      x: resting.x - frameRef.current.x,
      y: resting.y - frameRef.current.y,
    }
    const id = drag.addListener((value) => {
      liveRef.current = value
    })
    return () => drag.removeListener(id)
  }, [drag])

  const settleInto = useMemo(
    () => (target: MiniPlayerFrame) => {
      const base = frameRef.current
      const to = { x: target.x - base.x, y: target.y - base.y }
      settleRef.current?.stop()
      // KTD5: the drag node never takes the native driver.
      const animation = Animated.timing(drag, {
        toValue: to,
        duration: SNAP_DURATION_MS,
        useNativeDriver: false,
      })
      settleRef.current = animation
      animation.start()
      onCornerChangeRef.current(target.corner)
    },
    [drag],
  )

  const responder = useMemo(
    () =>
      PanResponder.create({
        // A tap belongs to the tap target below, never to the drag.
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        // Never capture: a touch that begins on a control belongs to it.
        onMoveShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          !controlTouchRef.current &&
          (Math.abs(gesture.dx) > DRAG_SLOP ||
            Math.abs(gesture.dy) > DRAG_SLOP),
        onPanResponderGrant: () => {
          settleRef.current?.stop()
          grabRef.current = { ...liveRef.current }
        },
        onPanResponderMove: (_event, gesture) => {
          // setValue, not Animated.event: KTD5 records that the native driver
          // fails silently under a PanResponder.
          drag.setValue({
            x: grabRef.current.x + gesture.dx,
            y: grabRef.current.y + gesture.dy,
          })
        },
        onPanResponderRelease: () => {
          const base = frameRef.current
          settleInto(
            snapToCorner(layoutRef.current, {
              x: base.x + liveRef.current.x,
              y: base.y + liveRef.current.y,
            }),
          )
        },
        onPanResponderTerminate: () => {
          settleInto(
            miniPlayerCornerFrame(layoutRef.current, cornerRef.current),
          )
        },
      }),
    [drag, settleInto],
  )

  // R21's crossfade, seeded from the mount state: a window that remounts
  // already ended (an R11 sheet closing over it) must not fade in again.
  const thumbnailOpacity = useRef(
    new Animated.Value(endedCause != null ? 1 : 0),
  ).current
  const previousEndedRef = useRef<MiniPlayerEndedCause | null>(endedCause)
  const onEndedFadeCompleteRef = useRef(onEndedFadeComplete)
  onEndedFadeCompleteRef.current = onEndedFadeComplete

  // Mounted ALREADY ended, so the fade above is skipped and its completion
  // never fires: the thumbnail is at full opacity from the first frame, and the
  // surface beneath it is owed no more frames (a hold held it, U9).
  const mountedEndedRef = useRef(endedCause)
  useEffect(() => {
    if (mountedEndedRef.current != null) onEndedFadeCompleteRef.current()
  }, [])

  useEffect(() => {
    const previous = previousEndedRef.current
    previousEndedRef.current = endedCause
    if (endedCause === previous) return
    if (endedCause == null) {
      thumbnailOpacity.setValue(0)
      return
    }
    if (endedCause === "failure") {
      // R22 swaps the surface for the poster outright — no last frame to hold.
      thumbnailOpacity.setValue(1)
      onEndedFadeCompleteRef.current()
      return
    }
    Animated.timing(thumbnailOpacity, {
      toValue: 1,
      duration: ENDED_FADE_DURATION_MS,
      useNativeDriver: true,
    }).start(() => onEndedFadeCompleteRef.current())
  }, [endedCause, thumbnailOpacity])

  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    // Inert through the exit: the same rule pointerEvents applies to touches.
    if (exiting) return
    switch (event.nativeEvent.actionName) {
      case "activate":
        onExpand()
        return
      case "playPause":
        if (failed) return
        if (ended) onReplay()
        else onPlayPause()
        return
      case "moveToCorner": {
        const corners = allowedCorners(layout)
        const next = corners[(corners.indexOf(corner) + 1) % corners.length]
        settleInto(miniPlayerCornerFrame(layout, next))
        return
      }
      case "dismiss":
        onDismiss()
    }
  }

  const ratio = progressFraction(positionSeconds, durationSeconds)
  const resolvedPoster = resolveImageUrl(posterUrl)
  const playPauseLabel = ended ? "Replay" : isPlaying ? "Pause" : "Play"
  const stateText = failed
    ? "playback failed"
    : ended
      ? "playback finished"
      : isPlaying
        ? "playing"
        : "paused"

  return (
    <View
      testID="mini-player-window"
      accessible
      accessibilityRole="button"
      accessibilityLabel={`Mini player, ${title}, ${stateText}`}
      accessibilityActions={MINI_PLAYER_ACCESSIBILITY_ACTIONS}
      onAccessibilityAction={handleAccessibilityAction}
      style={StyleSheet.absoluteFill}
      // Inert until the chrome is ready: the frame spans the DEPARTING player
      // rect for the whole shrink, and nothing tappable paints yet, so this
      // would otherwise swallow taps meant for the screen underneath.
      pointerEvents={exiting || !ready ? "none" : undefined}
      {...responder.panHandlers}
    >
      {resolvedPoster != null && (
        <Animated.View
          testID="mini-player-thumbnail"
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { opacity: thumbnailOpacity }]}
        >
          <Image
            source={resolvedPoster}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            recyclingKey="mini-player-thumbnail"
          />
        </Animated.View>
      )}

      {ready && (
        <>
          {/* Under the controls in paint order, so a control tap reaches the
              control. Silent to assistive tech — the root's activate covers it. */}
          <Pressable
            testID="mini-player-expand"
            style={StyleSheet.absoluteFill}
            onPress={onExpand}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />

          {failed && (
            <View style={styles.failureRow} pointerEvents="none">
              <Text style={styles.failureLabel}>
                {MINI_PLAYER_FAILURE_TEXT}
              </Text>
            </View>
          )}

          {!failed && (
            <Pressable
              style={[styles.control, styles.controlLeft]}
              accessibilityRole="button"
              accessibilityLabel={playPauseLabel}
              onPress={ended ? onReplay : onPlayPause}
              onPressIn={() => {
                controlTouchRef.current = true
              }}
              onPressOut={() => {
                controlTouchRef.current = false
              }}
              hitSlop={CONTROL_HIT_SLOP}
            >
              <Ionicons
                name={ended ? "refresh" : isPlaying ? "pause" : "play"}
                size={18}
                color={TEXT_ON_OVERLAY}
                style={styles.controlIcon}
              />
            </Pressable>
          )}

          <Pressable
            style={[styles.control, styles.controlRight]}
            accessibilityRole="button"
            accessibilityLabel={MINI_PLAYER_DISMISS_LABEL}
            onPress={onDismiss}
            onPressIn={() => {
              controlTouchRef.current = true
            }}
            onPressOut={() => {
              controlTouchRef.current = false
            }}
            hitSlop={CONTROL_HIT_SLOP}
          >
            <Ionicons
              name="close"
              size={18}
              color={TEXT_ON_OVERLAY}
              style={styles.controlIcon}
            />
          </Pressable>

          <View
            testID="mini-player-position"
            style={styles.positionTrack}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <View
              testID="mini-player-position-fill"
              style={[styles.positionFill, { width: `${ratio * 100}%` }]}
            />
          </View>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  // KTD8: no backplate. The shadow is what separates a control from the frame
  // beneath it, on the icon glyph too because Android draws no shadow for a
  // view with no background.
  control: {
    position: "absolute",
    top: 2,
    width: CONTROL_SIZE,
    height: CONTROL_SIZE,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: BLACK,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.6,
    shadowRadius: 3,
  },
  controlLeft: {
    left: 2,
  },
  controlRight: {
    right: 2,
  },
  controlIcon: {
    textShadowColor: hexToRgba(BLACK, 0.7),
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  failureRow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  failureLabel: {
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    textShadowColor: hexToRgba(BLACK, 0.7),
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  positionTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: hexToRgba(TEXT_ON_OVERLAY, 0.3),
  },
  positionFill: {
    height: 3,
    backgroundColor: ACCENT,
  },
})

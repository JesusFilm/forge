// The thin bar of a video part (R12), on the picture's bottom edge, where the
// picture fades into the run's ground. A tap or a drag on it seeks, as on the
// app's Explore clips (the owner, 2026-10-14).
import { useEffect, useRef, useState } from "react"
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

import { hexToRgba } from "../../lib/color"
import {
  PART_SEEK_STEP_SECONDS,
  partClockLabel,
} from "../../lib/dailyPause/partGestures"
import { pauseColors, pauseSizes } from "../../lib/dailyPause/theme"
import { RUN_BAR_CLEARANCE } from "../../lib/dailyPause/videoFrame"
import { clamp, thumbOutputRange } from "../../lib/scrubber"

/** The strip that takes a touch: a 44 pt band centred on the bar. It covers
 *  the faded foot of the picture and the ground below it. */
export const PART_BAR_HIT_ABOVE = 20
/** It ends at the bottom safe area, clear of the home indicator. */
const PART_BAR_HIT_BELOW = RUN_BAR_CLEARANCE
export const PART_BAR_HIT_HEIGHT =
  PART_BAR_HIT_ABOVE + pauseSizes.progressBarHeight + PART_BAR_HIT_BELOW
const THUMB = 12

type PartProgressBarProps = {
  /** 0 to 1. The part player writes it once a frame, with no render. */
  progress: Animated.Value
  /** The bar's top edge in window points. The touch strip starts above it. */
  top: number
  /** The part's length from its start to its stop, in seconds. */
  lengthSec: number
  /** False until the part shows: the bar then takes no touch. */
  enabled: boolean
  /** A drag starts. The part player stops writing `progress` until it ends. */
  onScrubStart: () => void
  /** A drag ends at a 0..1 place, or with null when the system takes it. */
  onScrubEnd: (fraction: number | null) => void
  /** A screen-reader step seeks to a 0..1 place. */
  onSeek: (fraction: number) => void
}

export function PartProgressBar({
  progress,
  top,
  lengthSec,
  enabled,
  onScrubStart,
  onScrubEnd,
  onSeek,
}: PartProgressBarProps) {
  const [width, setWidth] = useState(0)
  const [dragging, setDragging] = useState(false)
  // Whole seconds, so the bar renders once a second, not once a frame.
  const [elapsed, setElapsed] = useState(0)
  const [pillWidth, setPillWidth] = useState(0)
  const fractionRef = useRef(0)
  const lengthRef = useRef(lengthSec)
  lengthRef.current = lengthSec

  useEffect(() => {
    const id = progress.addListener(({ value }) => {
      fractionRef.current = value
      setElapsed(Math.floor(value * lengthRef.current))
    })
    return () => progress.removeListener(id)
  }, [progress])

  // The PanResponder is built once, so its handlers read these refs.
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const callbacks = useRef({ onScrubStart, onScrubEnd })
  callbacks.current = { onScrubStart, onScrubEnd }
  const widthRef = useRef(0)
  const grantXRef = useRef(0)

  const fractionAt = (x: number) =>
    widthRef.current > 0 ? clamp(x / widthRef.current, 0, 1) : 0

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => enabledRef.current,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        callbacks.current.onScrubStart()
        setDragging(true)
        grantXRef.current = e.nativeEvent.locationX
        progress.setValue(fractionAt(grantXRef.current))
      },
      onPanResponderMove: (
        _e: GestureResponderEvent,
        g: PanResponderGestureState,
      ) => {
        progress.setValue(fractionAt(grantXRef.current + g.dx))
      },
      // No pager or sheet in the run competes for a sideways drag.
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: () => {
        setDragging(false)
        callbacks.current.onScrubEnd(fractionRef.current)
      },
      onPanResponderTerminate: () => {
        setDragging(false)
        callbacks.current.onScrubEnd(null)
      },
    }),
  ).current

  const handleLayout = (e: LayoutChangeEvent) => {
    widthRef.current = e.nativeEvent.layout.width
    setWidth(e.nativeEvent.layout.width)
  }

  const handleAction = (e: AccessibilityActionEvent) => {
    if (!(lengthSec > 0)) return
    const step = PART_SEEK_STEP_SECONDS / lengthSec
    const delta = e.nativeEvent.actionName === "increment" ? step : -step
    onSeek(clamp(fractionRef.current + delta, 0, 1))
  }

  const total = Math.round(lengthSec)
  const thumbX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: thumbOutputRange(width, THUMB, true),
  })
  // The pill centres on the drag, and stops at the bar's two ends.
  const half = width > 0 ? pillWidth / 2 / width : 0
  const pillX =
    pillWidth > 0 && half < 0.5
      ? progress.interpolate({
          inputRange: [0, half, 1 - half, 1],
          outputRange: [0, 0, width - pillWidth, width - pillWidth],
          extrapolate: "clamp",
        })
      : 0

  return (
    <View
      testID="part-progress"
      pointerEvents={enabled ? "auto" : "none"}
      onLayout={handleLayout}
      // iOS promotes a plain View with a role only when `accessible` is set.
      accessible={enabled}
      accessibilityElementsHidden={!enabled}
      importantForAccessibility={enabled ? "yes" : "no-hide-descendants"}
      accessibilityRole="adjustable"
      accessibilityLabel="Video progress"
      accessibilityValue={{
        min: 0,
        max: total,
        now: elapsed,
        text: `${elapsed} of ${total} seconds`,
      }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={handleAction}
      style={[styles.hitArea, { top: top - PART_BAR_HIT_ABOVE }]}
      {...pan.panHandlers}
    >
      <View
        testID="part-progress-track"
        style={styles.track}
        pointerEvents="none"
      >
        <Animated.View
          testID="part-progress-fill"
          style={[styles.fill, { transform: [{ scaleX: progress }] }]}
        />
      </View>
      {dragging && width > 0 ? (
        <Animated.View
          testID="part-progress-thumb"
          pointerEvents="none"
          style={[styles.thumb, { transform: [{ translateX: thumbX }] }]}
        />
      ) : null}
      {dragging && width > 0 ? (
        <Animated.View
          testID="part-scrub-pill"
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
          <Text style={styles.pillText}>
            {`${partClockLabel(elapsed)} / ${partClockLabel(total)}`}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  hitArea: {
    position: "absolute",
    left: 0,
    right: 0,
    height: PART_BAR_HIT_HEIGHT,
  },
  track: {
    marginTop: PART_BAR_HIT_ABOVE,
    height: pauseSizes.progressBarHeight,
    backgroundColor: pauseColors.progressTrack,
    overflow: "hidden",
  },
  fill: {
    width: "100%",
    height: "100%",
    backgroundColor: pauseColors.white,
    transformOrigin: "left center",
  },
  thumb: {
    position: "absolute",
    top: PART_BAR_HIT_ABOVE + (pauseSizes.progressBarHeight - THUMB) / 2,
    left: 0,
    width: THUMB,
    height: THUMB,
    marginLeft: -THUMB / 2,
    borderRadius: THUMB / 2,
    backgroundColor: pauseColors.white,
  },
  // Above the bar, where the finger does not cover it, as on Explore.
  pill: {
    position: "absolute",
    left: 0,
    bottom: PART_BAR_HIT_BELOW + pauseSizes.progressBarHeight + 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: hexToRgba(pauseColors.background, 0.75),
  },
  // Fixed-width digits, so the pill does not change width as the time runs.
  pillText: {
    color: pauseColors.white,
    fontFamily: "System",
    fontSize: 13,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
})

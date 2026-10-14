// The section markers of a video part (v2 plan R2-R5, KTD4). A gold line draws
// to the part's section, which lights up. A tap on another marker opens that
// section's part; the current marker takes no tap (the owner, 2026-10-12).
import { useState } from "react"
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native"

import { pauseText, type PauseFont } from "../../lib/dailyPause/fonts"
import { pauseColors, pauseType } from "../../lib/dailyPause/theme"
import {
  CLOSE_RIGHT_EDGE,
  TARGET_SIZE as CLOSE_TARGET_SIZE,
} from "./CloseButton"
import { sampledCurve } from "./sampledCurve"
import { STAGES, type StepperStage } from "./StepperPills"
import { usePauseClock } from "./usePauseClock"
import { useRunVideoLayout } from "./useTopRowTop"

/** The close's target height, so the row and the close share one center. */
const ROW_HEIGHT = CLOSE_TARGET_SIZE
/** The space between two markers at the default text size (the owner,
 *  2026-10-14: 24 was too tight). */
export const MARKER_GAP = 40
/** WATCH, REFLECT, and PRAY at text scale 1 on the iPhone 17 simulator
 *  (53 + 64 + 39 points, 2026-10-14). The row's width starts from it. */
const LABELS_WIDTH = 156
/** The row keeps this much space clear of the close, on both sides. */
export const MARKER_CLOSE_CLEARANCE = 8
const MARKER_HIT_SLOP = 8
/** The row does not grow with the text past this scale, so it stays clear of
 *  the close on a narrow phone. VoiceOver reads the section in full. */
export const MARKER_MAX_SCALE = 1.3

const PRESSED_OPACITY = 0.6
const LINE_WIDTH = 2
/** The line sits below the text and inside the row, so it never meets the
 *  picture under the row. */
const LINE_BOTTOM = 8

/** A pause so the viewer sees the start, then the line and the light, in ms. */
const LEAD_MS = 200
const LINE_MS = 400
const LIGHT_MS = 400
/** How long the marker arrival plays, in ms. */
export const MARKER_ARRIVAL_MS = LEAD_MS + LINE_MS + LIGHT_MS

const EASE_POINTS = [0, 0.25, 0.5, 0.75, 1]
const easeOut = Easing.out(Easing.cubic)

function phase(progress: Animated.Value, fromMs: number, spanMs: number) {
  return sampledCurve(progress, {
    fromMs,
    spanMs,
    totalMs: MARKER_ARRIVAL_MS,
    curve: easeOut,
    points: EASE_POINTS,
  })
}

type SectionMarkersProps = {
  /** The section of the part that shows now. */
  section: StepperStage
  font: PauseFont
  /** A tap on another section's marker. */
  onSelect: (section: StepperStage) => void
}

export function SectionMarkers({
  section,
  font,
  onSelect,
}: SectionMarkersProps) {
  const top = useRunVideoLayout().rowTop
  const window = useWindowDimensions()
  // The labels sit at the row's two ends and its centre, so the gaps take
  // what is left. On a narrow phone with large text they close up rather
  // than let WATCH reach the close.
  const groupWidth = Math.min(
    LABELS_WIDTH * Math.min(window.fontScale, MARKER_MAX_SCALE) +
      2 * MARKER_GAP,
    window.width - 2 * (CLOSE_RIGHT_EDGE + MARKER_CLOSE_CLEARANCE),
  )
  const { progress } = usePauseClock(MARKER_ARRIVAL_MS)
  // The line runs from the left edge of WATCH to the right edge of the
  // current marker. That edge is known only after layout.
  const [lineLength, setLineLength] = useState(0)

  const line = phase(progress, LEAD_MS, LINE_MS)
  const light = phase(progress, LEAD_MS + LINE_MS, LIGHT_MS)
  const unlit = light.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })
  const labelStyle = pauseText(font, pauseType.label)

  const measure = ({ nativeEvent: { layout } }: LayoutChangeEvent) =>
    setLineLength(layout.x + layout.width)

  return (
    <View
      testID="section-markers"
      pointerEvents="box-none"
      style={[styles.row, { top }]}
    >
      <View
        testID="section-markers-group"
        pointerEvents="box-none"
        style={[styles.group, { width: groupWidth }]}
      >
        <View
          testID="section-markers-line"
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.line, { width: lineLength }]}
        >
          <Animated.View
            testID="section-markers-line-fill"
            style={[styles.lineFill, { transform: [{ scaleX: line }] }]}
          />
        </View>
        {STAGES.map(({ stage, label, name }) => {
          const current = stage === section
          return (
            <Pressable
              key={stage}
              onPress={current ? undefined : () => onSelect(stage)}
              disabled={current}
              onLayout={current ? measure : undefined}
              hitSlop={{ left: MARKER_HIT_SLOP, right: MARKER_HIT_SLOP }}
              accessibilityRole="button"
              accessibilityLabel={`${name} section`}
              accessibilityHint={
                current ? undefined : `Plays the ${name} part of the video`
              }
              accessibilityState={{ selected: current, disabled: current }}
              style={({ pressed }) => [
                styles.marker,
                pressed && styles.pressed,
              ]}
            >
              {current ? (
                <>
                  <Animated.Text
                    testID={`section-marker-${stage}-plain`}
                    maxFontSizeMultiplier={MARKER_MAX_SCALE}
                    style={[labelStyle, styles.plain, { opacity: unlit }]}
                  >
                    {label}
                  </Animated.Text>
                  <Animated.Text
                    testID={`section-marker-${stage}-gold`}
                    maxFontSizeMultiplier={MARKER_MAX_SCALE}
                    style={[labelStyle, styles.gold, { opacity: light }]}
                  >
                    {label}
                  </Animated.Text>
                </>
              ) : (
                <Animated.Text
                  testID={`section-marker-${stage}-plain`}
                  maxFontSizeMultiplier={MARKER_MAX_SCALE}
                  style={[labelStyle, styles.plain]}
                >
                  {label}
                </Animated.Text>
              )}
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    position: "absolute",
    left: 0,
    right: 0,
    height: ROW_HEIGHT,
    alignItems: "center",
  },
  group: {
    height: ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  marker: { height: ROW_HEIGHT, justifyContent: "center" },
  pressed: { opacity: PRESSED_OPACITY },
  plain: { color: pauseColors.ink },
  /** Over the plain label, so the light is a cross-fade, not a color tween. */
  gold: {
    position: "absolute",
    left: 0,
    right: 0,
    color: pauseColors.accent,
  },
  line: {
    position: "absolute",
    left: 0,
    bottom: LINE_BOTTOM,
    height: LINE_WIDTH,
  },
  lineFill: {
    flex: 1,
    backgroundColor: pauseColors.accent,
    transformOrigin: "left",
  },
})

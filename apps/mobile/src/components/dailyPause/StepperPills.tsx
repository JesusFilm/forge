// The stepper (R11 of the 2026-10-02 plan): each screen plays one arrival, and
// Reduce Motion shows the end. v2 plan: the pills share one width (R6, KTD2),
// and a tap on a pill button plays the arrival again (R7-R10, KTD1).
import { memo } from "react"
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"

import type { PauseFont } from "../../lib/dailyPause/fonts"
import {
  pauseColors,
  pauseRadii,
  pauseSpacing,
} from "../../lib/dailyPause/theme"
import { sampledCurve } from "./sampledCurve"
import { usePauseClock } from "./usePauseClock"

export type StepperStage = "watch" | "reflect" | "pray"

type PillLook = "active" | "done" | "upcoming"

const STAGES: readonly { stage: StepperStage; label: string; name: string }[] =
  [
    { stage: "watch", label: "WATCH", name: "Watch" },
    { stage: "reflect", label: "REFLECT", name: "Reflect" },
    { stage: "pray", label: "PRAY", name: "Pray" },
  ]

/** VoiceOver cannot see the fill, so the label says the state. */
const STATE_WORDS: Readonly<Record<PillLook, string>> = {
  active: "current step",
  done: "done",
  upcoming: "upcoming",
}

/** The widest label. Every pill takes its width in its two wide looks. */
const SIZER_LABEL = "REFLECT"

const PRESSED_OPACITY = 0.6

/** A pause so the viewer sees the start, then the phases of one step, in ms. */
const LEAD_MS = 250
const NODE_MS = 250
const LINE_MS = 400
const LIGHT_MS = 250

const NODE_SIZE = 18
const LINE_WIDTH = 3
const NODE_LINE_LENGTH = 28
const PILL_LINE_LENGTH = 18
/** The current pill's frame height. Every pill sits in a slot this tall, so a
 *  change of look never moves the column. */
const PILL_SLOT_HEIGHT = 46
/** Every part has a fixed height, so the stepper's height never changes. */
export const STEPPER_HEIGHT =
  NODE_SIZE +
  NODE_LINE_LENGTH +
  STAGES.length * PILL_SLOT_HEIGHT +
  (STAGES.length - 1) * PILL_LINE_LENGTH

type Phase = { from: number; to: number }
type Plan = {
  totalMs: number
  node?: Phase
  line: Phase
  light: Phase
}

/** Where each phase sits in one step, in ms from its start. */
function planFor(arrival: StepperStage): Plan {
  const nodeMs = arrival === "watch" ? NODE_MS : 0
  const lineFrom = LEAD_MS + nodeMs
  const lightFrom = lineFrom + LINE_MS
  return {
    totalMs: lightFrom + LIGHT_MS,
    node: arrival === "watch" ? { from: LEAD_MS, to: lineFrom } : undefined,
    line: { from: lineFrom, to: lightFrom },
    light: { from: lightFrom, to: lightFrom + LIGHT_MS },
  }
}

/** How long the arrival step plays, in ms. */
export function stepperArrivalMs(arrival: StepperStage): number {
  return planFor(arrival).totalMs
}

type Level = number | Animated.AnimatedInterpolation<number>

/** Five points are enough for a step this short. */
const EASE_POINTS = [0, 0.25, 0.5, 0.75, 1]
const easeOut = Easing.out(Easing.cubic)

function phaseLevel(
  progress: Animated.Value,
  phase: Phase,
  totalMs: number,
): Level {
  return sampledCurve(progress, {
    fromMs: phase.from,
    spanMs: phase.to - phase.from,
    totalMs,
    curve: easeOut,
    points: EASE_POINTS,
  })
}

function inverse(level: Level): Level {
  return typeof level === "number"
    ? 1 - level
    : level.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })
}

type StepperPillsProps = {
  /** The step the path arrives at. */
  arrival: StepperStage
  font: PauseFont
}

/** The Reflect and Pray screens render each second for their timers; the
 *  stepper's props do not change then, so it does not render again. */
export const StepperPills = memo(function StepperPills({
  arrival,
  font,
}: StepperPillsProps) {
  const plan = planFor(arrival)
  const { progress, run, restart } = usePauseClock(plan.totalMs)
  const index = STAGES.findIndex(({ stage }) => stage === arrival)

  const step = (phase: Phase): Level =>
    phaseLevel(progress, phase, plan.totalMs)
  const light = step(plan.light)
  const lineLevel = (line: number): Level =>
    line < index ? 1 : line === index ? step(plan.line) : 0
  const topNode: Level = plan.node ? step(plan.node) : 1

  /** The level of each look of one pill, from 0 (hidden) to 1 (shown). */
  function looks(pill: number): Record<PillLook, Level> {
    if (pill === index)
      return { upcoming: inverse(light), active: light, done: 0 }
    if (pill === index - 1)
      return { upcoming: 0, active: inverse(light), done: light }
    if (pill < index) return { upcoming: 0, active: 0, done: 1 }
    return { upcoming: 1, active: 0, done: 0 }
  }

  function endLook(pill: number): PillLook {
    return pill < index ? "done" : pill === index ? "active" : "upcoming"
  }

  // iOS keeps a native-driven view's last values, so each run mounts new
  // layers (KTD1). The buttons stay mounted, so VoiceOver keeps its focus.
  return (
    <View style={styles.stepper}>
      <Node testID="stepper-node-top" lit={topNode} run={run} />
      <Line
        testID="stepper-line-0"
        length={NODE_LINE_LENGTH}
        level={lineLevel(0)}
        run={run}
      />
      {STAGES.map(({ stage, label, name }, pill) => {
        const levels = looks(pill)
        return (
          <View key={stage} style={styles.slotGroup}>
            <Pressable
              onPress={restart}
              accessibilityRole="button"
              accessibilityLabel={`${name}, ${STATE_WORDS[endLook(pill)]}`}
              style={({ pressed }) => [
                styles.target,
                pressed && styles.pressed,
              ]}
            >
              <PillSizer stage={stage} font={font} />
              {(["upcoming", "done", "active"] as const).map((one) => (
                <Animated.View
                  key={`${one}-${run}`}
                  testID={`stepper-${stage}-${one}`}
                  style={[
                    styles.pill,
                    styles.look,
                    pillStyles[one],
                    { opacity: levels[one] },
                  ]}
                >
                  {one === "done" ? (
                    <Text style={[styles.check, font("sansBold")]}>✓</Text>
                  ) : null}
                  <Text
                    style={[
                      one === "active" ? styles.activeLabel : styles.label,
                      font("sansBold"),
                    ]}
                  >
                    {label}
                  </Text>
                </Animated.View>
              ))}
            </Pressable>
            {pill < STAGES.length - 1 ? (
              <Line
                testID={`stepper-line-${pill + 1}`}
                length={PILL_LINE_LENGTH}
                level={lineLevel(pill + 1)}
                run={run}
              />
            ) : null}
          </View>
        )
      })}
    </View>
  )
})

/** Unseen copies of the widest label in its two wide looks. They give each
 *  pill, and its button, one width that follows the text size (KTD2). */
function PillSizer({ stage, font }: { stage: StepperStage; font: PauseFont }) {
  return (
    <View
      testID={`stepper-${stage}-sizer`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.sizer}
    >
      <View testID={`stepper-${stage}-sizer-active`} style={styles.pill}>
        <Text style={[styles.activeLabel, font("sansBold")]}>
          {SIZER_LABEL}
        </Text>
      </View>
      <View testID={`stepper-${stage}-sizer-done`} style={styles.pill}>
        <Text style={[styles.check, font("sansBold")]}>✓</Text>
        <Text style={[styles.label, font("sansBold")]}>{SIZER_LABEL}</Text>
      </View>
    </View>
  )
}

/** The top node: an outline ring, and a disc that fades in over it.
 *  The disc has the ring's own outer edge, so a lit node shows no seam. */
function Node({
  testID,
  lit,
  run,
}: {
  testID: string
  lit: Level
  run: number
}) {
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.node}
    >
      <View style={styles.nodeRing} />
      <Animated.View
        key={run}
        testID={`${testID}-fill`}
        style={[styles.nodeFill, { opacity: lit }]}
      />
    </View>
  )
}

/** One segment of the path. It draws downward from its top as it lights. */
function Line({
  testID,
  length,
  level,
  run,
}: {
  testID: string
  length: number
  level: Level
  run: number
}) {
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.line, { height: length }]}
    >
      <Animated.View
        key={run}
        testID={`${testID}-fill`}
        style={[styles.lineFill, { transform: [{ scaleY: level }] }]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  stepper: { alignItems: "center", alignSelf: "stretch" },
  slotGroup: { alignItems: "center", alignSelf: "stretch" },
  /** The pill button: the sizer's width and the slot's full height. */
  target: {
    maxWidth: "100%",
    height: PILL_SLOT_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: PRESSED_OPACITY },
  /** No height, so the sizer gives the button only its width. */
  sizer: { height: 0, opacity: 0 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: pauseSpacing.pillPaddingX,
  },
  look: {
    position: "absolute",
    left: 0,
    right: 0,
    justifyContent: "center",
    paddingVertical: pauseSpacing.pillPaddingY,
    borderRadius: pauseRadii.pill,
  },
  activeLabel: {
    flexShrink: 1,
    color: pauseColors.background,
    fontSize: 18,
    letterSpacing: 1.4,
  },
  label: {
    flexShrink: 1,
    color: pauseColors.ink,
    fontSize: 14,
    letterSpacing: 1.4,
  },
  check: {
    marginRight: pauseSpacing.pillCheckGap,
    color: pauseColors.accent,
    fontSize: 14,
  },
  node: { width: NODE_SIZE, height: NODE_SIZE },
  nodeRing: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: NODE_SIZE / 2,
    borderWidth: 2.5,
    borderColor: pauseColors.ink,
  },
  nodeFill: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: NODE_SIZE / 2,
    backgroundColor: pauseColors.ink,
  },
  line: { width: LINE_WIDTH },
  lineFill: {
    flex: 1,
    backgroundColor: pauseColors.ink,
    transformOrigin: "top",
  },
})

const pillStyles = StyleSheet.create({
  active: { backgroundColor: pauseColors.ink },
  done: { backgroundColor: pauseColors.raised },
  upcoming: {
    backgroundColor: pauseColors.background,
    borderWidth: 1,
    borderColor: pauseColors.pillBorder,
  },
})

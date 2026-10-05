// The WATCH, REFLECT, and PRAY stepper (R11) as a path down from a top node
// (the owner, 2026-10-06). Each screen plays one arrival step: a line draws to
// the next pill, which lights up. Reduce Motion shows the end.
import { useEffect, useState } from "react"
import { Animated, Easing, StyleSheet, Text, View } from "react-native"

import { useReduceMotion } from "../../hooks/useReduceMotion"
import type { PauseFace, PauseFontStyle } from "../../lib/dailyPause/fonts"
import {
  pauseColors,
  pauseRadii,
  pauseSpacing,
} from "../../lib/dailyPause/theme"

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

type Level = number | Animated.AnimatedInterpolation<number>

/** Points on an ease-out curve. The native driver rejects an `easing` key in
 *  an interpolation, so the curve rides in the ranges instead. */
const EASE_POINTS = [0, 0.25, 0.5, 0.75, 1]
const easeOut = Easing.out(Easing.cubic)

function phaseLevel(
  progress: Animated.Value,
  phase: Phase,
  totalMs: number,
): Level {
  const span = phase.to - phase.from
  return progress.interpolate({
    inputRange: EASE_POINTS.map((t) => (phase.from + t * span) / totalMs),
    outputRange: EASE_POINTS.map((t) => easeOut(t)),
    extrapolate: "clamp",
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
  font: (face: PauseFace) => PauseFontStyle
}

export function StepperPills({ arrival, font }: StepperPillsProps) {
  const reduceMotion = useReduceMotion()
  const [progress] = useState(() => new Animated.Value(0))
  const plan = planFor(arrival)
  const index = STAGES.findIndex(({ stage }) => stage === arrival)

  useEffect(() => {
    if (reduceMotion) return
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: plan.totalMs,
      easing: Easing.linear,
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [progress, reduceMotion, plan.totalMs])

  // Under Reduce Motion every phase has played: plain values, no animation.
  const step = (phase: Phase): Level =>
    reduceMotion ? 1 : phaseLevel(progress, phase, plan.totalMs)
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

  return (
    <View style={styles.stepper}>
      <Node testID="stepper-node-top" lit={topNode} />
      <Line
        testID="stepper-line-0"
        length={NODE_LINE_LENGTH}
        level={lineLevel(0)}
      />
      {STAGES.map(({ stage, label, name }, pill) => {
        const levels = looks(pill)
        return (
          <View key={stage} style={styles.slotGroup}>
            <View
              accessible
              accessibilityLabel={`${name}, ${STATE_WORDS[endLook(pill)]}`}
              style={styles.slot}
            >
              {(["upcoming", "done", "active"] as const).map((one) => (
                <Animated.View
                  key={one}
                  testID={`stepper-${stage}-${one}`}
                  style={[
                    styles.pill,
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
            </View>
            {pill < STAGES.length - 1 ? (
              <Line
                testID={`stepper-line-${pill + 1}`}
                length={PILL_LINE_LENGTH}
                level={lineLevel(pill + 1)}
              />
            ) : null}
          </View>
        )
      })}
    </View>
  )
}

/** The top node: an outline ring, and a disc that fades in over it.
 *  The disc has the ring's own outer edge, so a lit node shows no seam. */
function Node({ testID, lit }: { testID: string; lit: Level }) {
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.node}
    >
      <View style={styles.nodeRing} />
      <Animated.View
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
}: {
  testID: string
  length: number
  level: Level
}) {
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.line, { height: length }]}
    >
      <Animated.View
        testID={`${testID}-fill`}
        style={[styles.lineFill, { transform: [{ scaleY: level }] }]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  stepper: { alignItems: "center", alignSelf: "stretch" },
  slotGroup: { alignItems: "center", alignSelf: "stretch" },
  slot: {
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    height: PILL_SLOT_HEIGHT,
  },
  pill: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    maxWidth: "100%",
    paddingHorizontal: pauseSpacing.pillPaddingX,
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

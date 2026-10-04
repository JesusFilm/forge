// The Figma pill stepper (R11): WATCH, REFLECT, and PRAY in a centered column.
// A pill before the active one is done, and a pill after it is upcoming.
import { StyleSheet, Text, View } from "react-native"

import type { PauseFace, PauseFontStyle } from "../../lib/dailyPause/fonts"
import {
  pauseColors,
  pauseRadii,
  pauseSpacing,
} from "../../lib/dailyPause/theme"

export type StepperStage = "watch" | "reflect" | "pray"

type PillState = "active" | "done" | "upcoming"

const STAGES: readonly { stage: StepperStage; label: string; name: string }[] =
  [
    { stage: "watch", label: "WATCH", name: "Watch" },
    { stage: "reflect", label: "REFLECT", name: "Reflect" },
    { stage: "pray", label: "PRAY", name: "Pray" },
  ]

/** VoiceOver cannot see the fill, so the label says the state. */
const STATE_WORDS: Readonly<Record<PillState, string>> = {
  active: "current step",
  done: "done",
  upcoming: "upcoming",
}

type StepperPillsProps = {
  active: StepperStage
  font: (face: PauseFace) => PauseFontStyle
}

export function StepperPills({ active, font }: StepperPillsProps) {
  const activeIndex = STAGES.findIndex((entry) => entry.stage === active)

  return (
    <View style={styles.stepper}>
      {STAGES.map(({ stage, label, name }, index) => {
        const state: PillState =
          index < activeIndex
            ? "done"
            : index === activeIndex
              ? "active"
              : "upcoming"
        return (
          <View
            key={stage}
            accessible
            accessibilityLabel={`${name}, ${STATE_WORDS[state]}`}
            style={[styles.pill, pillStyles[state]]}
          >
            {state === "done" ? (
              <Text style={[styles.check, font("sansBold")]}>✓</Text>
            ) : null}
            <Text
              style={[
                state === "active" ? styles.activeLabel : styles.label,
                font("sansBold"),
              ]}
            >
              {label}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  stepper: {
    alignItems: "center",
    gap: pauseSpacing.stepperGap,
  },
  pill: {
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

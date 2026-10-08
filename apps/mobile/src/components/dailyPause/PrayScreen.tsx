// The Figma "Transition · Pray" screen (R11, R16, R17, R19, R30). The ring
// counts the pause down while Amen shows grey and takes no tap; the end is in
// PauseFinish. The screen opens with the intro in PauseIntro.
import { ScrollView, StyleSheet, Text, View } from "react-native"

import { useCountdown } from "../../lib/dailyPause/countdown"
import type { Devotional } from "../../lib/dailyPause/devotionals"
import {
  PAUSE_TIMERS,
  type MeditationLength,
} from "../../lib/dailyPause/settings"
import {
  pauseColors,
  pauseSpacing,
  pauseType,
} from "../../lib/dailyPause/theme"
import {
  IntroContent,
  IntroCovered,
  IntroStepper,
  usePauseIntro,
} from "./PauseIntro"
import { FinishButton, FinishRing, usePauseFinish } from "./PauseFinish"
import { StepperPills, type StepperStage } from "./StepperPills"
import { pauseText, type PauseFont } from "../../lib/dailyPause/fonts"
import { PauseBody } from "./PauseFrame"

const AMEN = "Amen"

type PrayScreenProps = {
  /** The run's pinned devotional. */
  devotional: Devotional
  meditationLength: MeditationLength
  font: PauseFont
  onContinue: () => void
  /** Opens a section from a stepper pill. */
  onJump?: (stage: StepperStage) => void
}

export function PrayScreen({
  devotional,
  meditationLength,
  font,
  onContinue,
  onJump,
}: PrayScreenProps) {
  const intro = usePauseIntro("pray")
  const countdown = useCountdown(
    PAUSE_TIMERS[meditationLength].praySec,
    intro.shown,
  )
  const finish = usePauseFinish(countdown.done)

  return (
    <PauseBody>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        onLayout={intro.onScrollLayout}
      >
        <IntroStepper intro={intro}>
          <StepperPills arrival="pray" font={font} onSelect={onJump} />
        </IntroStepper>
        <View style={styles.spacer} />
        <IntroContent intro={intro} style={styles.content}>
          <FinishRing countdown={countdown} finish={finish} font={font} />
          <Text style={[styles.prompt, pauseText(font, pauseType.reading)]}>
            {devotional.prayerPrompt}
          </Text>
          <Text style={[styles.attribution, pauseText(font, pauseType.label)]}>
            {devotional.attribution}
          </Text>
        </IntroContent>
      </ScrollView>
      <IntroCovered intro={intro} style={styles.buttonRow}>
        <FinishButton
          label={AMEN}
          finish={finish}
          font={font}
          onPress={onContinue}
        />
      </IntroCovered>
    </PauseBody>
  )
}

const styles = StyleSheet.create({
  // Reflect's layout, so Amen sits where Continue does (the owner,
  // 2026-10-08): the spacer pushes the prayer down onto the button.
  scroll: { flex: 1, alignSelf: "stretch" },
  scrollContent: {
    flexGrow: 1,
    alignItems: "center",
    gap: pauseSpacing.screenGap,
  },
  spacer: { flex: 1 },
  content: {
    alignSelf: "stretch",
    alignItems: "center",
    gap: pauseSpacing.screenGap,
  },
  // The body's own gap already sits above the button, so the margin adds
  // only the rest of the gap.
  buttonRow: {
    alignSelf: "stretch",
    alignItems: "center",
    marginTop: pauseSpacing.pauseButtonGap - pauseSpacing.screenGap,
    marginBottom: pauseSpacing.pauseButtonLift,
  },
  prompt: {
    alignSelf: "stretch",
    color: pauseColors.ink,
  },
  attribution: {
    alignSelf: "stretch",
    color: pauseColors.accent,
  },
})

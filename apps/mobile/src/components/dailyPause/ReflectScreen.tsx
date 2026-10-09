// The Figma "Transition · Reflect" screen (R11, R16-R18, R30; v2 plan R11-R15,
// KTD3): the stepper, the ring, the verse, its reference, and the pause line.
// The end is in PauseFinish, and the intro is in PauseIntro.
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
import { StepperPills } from "./StepperPills"
import { pauseText, type PauseFont } from "../../lib/dailyPause/fonts"
import { PauseBody } from "./PauseFrame"

const CONTINUE = "Continue"

type ReflectScreenProps = {
  /** The run's pinned devotional. */
  devotional: Devotional
  meditationLength: MeditationLength
  font: PauseFont
  onContinue: () => void
}

export function ReflectScreen({
  devotional,
  meditationLength,
  font,
  onContinue,
}: ReflectScreenProps) {
  const intro = usePauseIntro("reflect")
  const countdown = useCountdown(
    PAUSE_TIMERS[meditationLength].reflectSec,
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
          <StepperPills arrival="reflect" font={font} />
        </IntroStepper>
        <View style={styles.ringGap} />
        <IntroContent intro={intro} style={styles.content}>
          <FinishRing countdown={countdown} finish={finish} font={font} />
          <Text style={[styles.verse, pauseText(font, pauseType.reading)]}>
            {devotional.verse}
          </Text>
          <Text style={[styles.label, pauseText(font, pauseType.label)]}>
            {devotional.verseLabel}
          </Text>
          <Text style={[styles.waiting, pauseText(font, pauseType.note)]}>
            We’ll give you some time.
          </Text>
        </IntroContent>
      </ScrollView>
      <IntroCovered intro={intro} style={styles.buttonRow}>
        <FinishButton
          label={CONTINUE}
          finish={finish}
          font={font}
          onPress={onContinue}
        />
      </IntroCovered>
    </PauseBody>
  )
}

const styles = StyleSheet.create({
  // It fills the body down to Continue, so the free space stays below the
  // pause line and Continue stays at the bottom (R15).
  scroll: { flex: 1, alignSelf: "stretch" },
  scrollContent: {
    alignItems: "center",
    gap: pauseSpacing.screenGap,
  },
  content: {
    alignSelf: "stretch",
    alignItems: "center",
    gap: pauseSpacing.screenGap,
  },
  ringGap: { height: pauseSpacing.ringGap },
  // The body's own gap already sits above the button, so the margin adds
  // only the rest of the Reflect gap.
  buttonRow: {
    alignSelf: "stretch",
    alignItems: "center",
    marginTop: pauseSpacing.reflectButtonGap - pauseSpacing.screenGap,
    marginBottom: pauseSpacing.reflectButtonLift,
  },
  verse: {
    alignSelf: "stretch",
    color: pauseColors.ink,
  },
  label: {
    alignSelf: "stretch",
    color: pauseColors.accent,
  },
  waiting: {
    alignSelf: "stretch",
    color: pauseColors.muted,
  },
})

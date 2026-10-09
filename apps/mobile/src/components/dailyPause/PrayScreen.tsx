// The Figma "Transition · Pray" screen (R11, R16, R17, R19, R30; v2 plan R12,
// R13, KTD3). The ring counts the pause down while Amen shows grey and takes
// no tap; the end is in PauseFinish. The intro is in PauseIntro.
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

const AMEN = "Amen"

type PrayScreenProps = {
  /** The run's pinned devotional. */
  devotional: Devotional
  meditationLength: MeditationLength
  font: PauseFont
  onContinue: () => void
}

export function PrayScreen({
  devotional,
  meditationLength,
  font,
  onContinue,
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
          <StepperPills arrival="pray" font={font} />
        </IntroStepper>
        <View style={styles.ringGap} />
        <IntroContent intro={intro} style={styles.content}>
          <FinishRing countdown={countdown} finish={finish} font={font} />
          <Text style={[styles.prompt, pauseText(font, pauseType.reading)]}>
            {devotional.prayerPrompt}
          </Text>
          <Text style={[styles.attribution, pauseText(font, pauseType.label)]}>
            {devotional.attribution}
          </Text>
        </IntroContent>
        <View style={styles.buttonGap} />
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
  // It takes its content's height, and it shrinks and scrolls only when the
  // content does not fit, so the free space stays below Amen as in the frame.
  scroll: { flexGrow: 0, alignSelf: "stretch" },
  scrollContent: {
    alignItems: "center",
    gap: pauseSpacing.screenGap,
  },
  content: {
    alignSelf: "stretch",
    alignItems: "center",
    gap: pauseSpacing.screenGap,
  },
  buttonRow: { alignSelf: "stretch", alignItems: "center" },
  ringGap: { height: pauseSpacing.ringGap },
  prompt: {
    alignSelf: "stretch",
    color: pauseColors.ink,
  },
  attribution: {
    alignSelf: "stretch",
    color: pauseColors.accent,
  },
  buttonGap: { height: pauseSpacing.prayButtonGap },
})

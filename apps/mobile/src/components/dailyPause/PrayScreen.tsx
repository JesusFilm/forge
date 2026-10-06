// The Figma "Transition · Pray" screen (R11, R16, R17, R19, R30). The ring
// counts the pause down, and Amen takes no tap before zero. The screen opens
// with the intro in PauseIntro, and the pause starts after.
import { ScrollView, StyleSheet, Text, View } from "react-native"

import { useCountdown } from "../../lib/dailyPause/countdown"
import type { Devotional } from "../../lib/dailyPause/devotionals"
import {
  PAUSE_TIMERS,
  type MeditationLength,
} from "../../lib/dailyPause/settings"
import {
  pauseColors,
  pauseSizes,
  pauseSpacing,
} from "../../lib/dailyPause/theme"
import { CountdownRing } from "./CountdownRing"
import {
  IntroContent,
  IntroCovered,
  IntroStepper,
  usePauseIntro,
} from "./PauseIntro"
import { Pulse } from "./Pulse"
import { HeldPauseButton } from "./ReflectScreen"
import { StepperPills } from "./StepperPills"
import { PauseBody, PauseButton, type PauseFont } from "./WatchScreen"

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
          <View style={styles.ringBox}>
            <CountdownRing countdown={countdown} font={font} />
          </View>
          <Text style={[styles.prompt, font("bodyLightItalic")]}>
            {devotional.prayerPrompt}
          </Text>
          <Text style={[styles.attribution, font("bodyItalic")]}>
            {devotional.attribution}
          </Text>
        </IntroContent>
        <View style={styles.buttonGap} />
      </ScrollView>
      <IntroCovered intro={intro} style={styles.buttonRow}>
        {countdown.done ? (
          <Pulse>
            <PauseButton label="Amen" onPress={onContinue} font={font} />
          </Pulse>
        ) : (
          <HeldPauseButton label="Amen" spokenLabel="Amen" font={font} />
        )}
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
  ringGap: { height: pauseSpacing.prayRingGap },
  ringBox: {
    alignSelf: "stretch",
    height: pauseSizes.prayRingBoxHeight,
    alignItems: "center",
    justifyContent: "center",
  },
  prompt: {
    alignSelf: "stretch",
    color: pauseColors.ink,
    fontSize: 24,
    lineHeight: 34,
  },
  attribution: {
    alignSelf: "stretch",
    color: pauseColors.muted,
    fontSize: 13,
    lineHeight: 20,
  },
  buttonGap: { height: pauseSpacing.prayButtonGap },
})

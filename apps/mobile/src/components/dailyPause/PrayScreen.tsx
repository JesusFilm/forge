// The Figma "Transition · Pray" screen (R11, R16, R17, R19, R30). The ring
// counts the pause down, and Amen takes no tap before zero. The content stacks
// from the top; it scrolls at large text sizes, and Amen stays on screen.
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
  const countdown = useCountdown(PAUSE_TIMERS[meditationLength].praySec)

  return (
    <PauseBody>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        <StepperPills active="pray" font={font} />
        <View style={styles.ringGap} />
        <View style={styles.ringBox}>
          <CountdownRing countdown={countdown} font={font} />
        </View>
        <Text style={[styles.prompt, font("bodyLightItalic")]}>
          {devotional.prayerPrompt}
        </Text>
        <Text style={[styles.attribution, font("bodyItalic")]}>
          {devotional.attribution}
        </Text>
        <View style={styles.buttonGap} />
      </ScrollView>
      {countdown.done ? (
        <PauseButton label="Amen" onPress={onContinue} font={font} />
      ) : (
        <HeldPauseButton label="Amen" spokenLabel="Amen" font={font} />
      )}
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

// The Figma "Transition · Watch" screen (R10, R11).
import { StyleSheet, View } from "react-native"

import type { PauseFont } from "../../lib/dailyPause/fonts"
import type { MeditationLength } from "../../lib/dailyPause/settings"
import { pauseSpacing } from "../../lib/dailyPause/theme"
import { PauseBody, PauseButton, PauseMasthead } from "./PauseFrame"
import { Pulse } from "./Pulse"
import { StepperPills } from "./StepperPills"

type WatchScreenProps = {
  meditationLength: MeditationLength
  font: PauseFont
  onContinue: () => void
}

export function WatchScreen({
  meditationLength,
  font,
  onContinue,
}: WatchScreenProps) {
  return (
    <PauseBody>
      <PauseMasthead meditationLength={meditationLength} font={font} />
      <View style={styles.spacer} />
      {/* The first screen's pills take no tap (the owner, 2026-10-09). */}
      <StepperPills arrival="watch" font={font} />
      <View style={styles.spacer} />
      <View style={styles.buttonRow}>
        <Pulse>
          <PauseButton label="Continue" onPress={onContinue} font={font} />
        </Pulse>
      </View>
    </PauseBody>
  )
}

const styles = StyleSheet.create({
  spacer: { flex: 1 },
  buttonRow: { alignSelf: "stretch", marginBottom: pauseSpacing.buttonLift },
})

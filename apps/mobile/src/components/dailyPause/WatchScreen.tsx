// The Figma "Transition · Watch" screen (R10, R11).
import { StyleSheet, View } from "react-native"

import type { PauseFont } from "../../lib/dailyPause/fonts"
import type { MeditationLength } from "../../lib/dailyPause/settings"
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
      <StepperPills arrival="watch" font={font} />
      <View style={styles.spacer} />
      <Pulse>
        <PauseButton label="Continue" onPress={onContinue} font={font} />
      </Pulse>
    </PauseBody>
  )
}

const styles = StyleSheet.create({
  spacer: { flex: 1 },
})

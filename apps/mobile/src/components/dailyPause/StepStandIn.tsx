// A temporary step that lets a run walk every R10 step before its real screen
// exists. U9 replaces the video parts, U10 the Reflect and Pray screens, and
// U11 Share; the last of them deletes this file.
import { StyleSheet, Text, View, useWindowDimensions } from "react-native"

import { isVideoPart, type RunStep } from "../../lib/dailyPause/run"
import { pauseColors } from "../../lib/dailyPause/theme"
import { devotionalVideoFrame } from "./CloseButton"
import { StepperPills, type StepperStage } from "./StepperPills"
import { PauseBody, PauseButton, type PauseFont } from "./WatchScreen"

export type StandInStep = Exclude<RunStep, "watchScreen">

const NAMES: Readonly<Record<StandInStep, string>> = {
  film: "Film part",
  teaching: "Teaching part",
  reflectScreen: "Reflect",
  prayer: "Prayer part",
  prayScreen: "Pray",
  share: "Share",
}

const STAGES: Partial<Record<StandInStep, StepperStage>> = {
  reflectScreen: "reflect",
  prayScreen: "pray",
}

/** Share does nothing yet; U11 adds the share sheet. */
function shareLater() {}

type StepStandInProps = {
  step: StandInStep
  font: PauseFont
  onContinue: () => void
}

export function StepStandIn({ step, font, onContinue }: StepStandInProps) {
  const window = useWindowDimensions()
  const stage = STAGES[step]
  const frame = devotionalVideoFrame(window.width, window.height)

  return (
    <View style={StyleSheet.absoluteFill}>
      {isVideoPart(step) ? (
        <View
          style={[styles.videoFrame, { top: frame.top, height: frame.height }]}
        />
      ) : null}
      <PauseBody>
        {stage ? <StepperPills active={stage} font={font} /> : null}
        <View style={styles.spacer} />
        <Text style={[styles.name, font("display")]}>{NAMES[step]}</Text>
        <View style={styles.spacer} />
        {step === "share" ? (
          <PauseButton
            label="Share this video"
            onPress={shareLater}
            font={font}
          />
        ) : (
          <PauseButton label="Continue" onPress={onContinue} font={font} />
        )}
      </PauseBody>
    </View>
  )
}

const styles = StyleSheet.create({
  videoFrame: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: pauseColors.raised,
  },
  spacer: { flex: 1 },
  name: {
    color: pauseColors.ink,
    fontSize: 48,
    textAlign: "center",
  },
})

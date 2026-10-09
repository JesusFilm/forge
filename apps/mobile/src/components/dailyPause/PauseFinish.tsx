// The end of a timed pause on Reflect and Pray (v2 plan R11-R13, KTD3). The
// ring counts down while the button shows grey and takes no tap. At zero the
// ring fades out, then the grey fades off the cream button.
import { useEffect, useState } from "react"
import { Animated, Easing, StyleSheet, Text, View } from "react-native"

import type { Countdown } from "../../lib/dailyPause/countdown"
import { pauseText, type PauseFont } from "../../lib/dailyPause/fonts"
import {
  pauseColors,
  pauseRadii,
  pauseSizes,
  pauseType,
} from "../../lib/dailyPause/theme"
import { CountdownRing } from "./CountdownRing"
import { HeldPauseButton, PauseButton } from "./PauseFrame"
import { Pulse } from "./Pulse"
import { sampledCurve } from "./sampledCurve"
import { usePauseClock } from "./usePauseClock"

/** At zero the ring fades out over this time. */
export const RING_FADE_MS = 500
/** The button starts to turn cream, and takes taps, this long after zero. */
export const BUTTON_FROM_MS = 300
const BUTTON_FADE_MS = 500
/** The button is fully cream this long after zero. */
export const FINISH_MS = BUTTON_FROM_MS + BUTTON_FADE_MS

const easeInOut = Easing.inOut(Easing.cubic)
const easeOut = Easing.out(Easing.cubic)

export type PauseFinish = {
  /** The ring's opacity. */
  ring: Animated.AnimatedInterpolation<number>
  /** The grey over the button: 1 grey, 0 cream. */
  grey: Animated.AnimatedInterpolation<number>
  /** The button takes taps. */
  enabled: boolean
}

/** The change at zero, on one clock: the ring fades out, then the grey fades
 *  off the button. */
export function usePauseFinish(done: boolean): PauseFinish {
  const { progress, reduceMotion } = usePauseClock(FINISH_MS, done)
  const [buttonDue, setButtonDue] = useState(false)
  const [levels] = useState(() => ({
    ring: sampledCurve(progress, {
      fromMs: 0,
      spanMs: RING_FADE_MS,
      totalMs: FINISH_MS,
      curve: (t) => 1 - easeInOut(t),
    }),
    grey: sampledCurve(progress, {
      fromMs: BUTTON_FROM_MS,
      spanMs: BUTTON_FADE_MS,
      totalMs: FINISH_MS,
      curve: (t) => 1 - easeOut(t),
    }),
  }))

  // A native completion callback is unreliable on this app, so the button
  // takes taps from its own clock.
  useEffect(() => {
    if (!done || reduceMotion) return
    const timer = setTimeout(() => setButtonDue(true), BUTTON_FROM_MS)
    return () => clearTimeout(timer)
  }, [done, reduceMotion])

  return { ...levels, enabled: done && (reduceMotion || buttonDue) }
}

/** The countdown ring in its box. VoiceOver skips it from zero. */
export function FinishRing({
  countdown,
  finish,
  font,
}: {
  countdown: Countdown
  finish: PauseFinish
  font: PauseFont
}) {
  return (
    <View style={styles.ringBox}>
      <Animated.View
        testID="pause-ring-fade"
        accessibilityElementsHidden={countdown.done}
        importantForAccessibility={
          countdown.done ? "no-hide-descendants" : "auto"
        }
        style={{ opacity: finish.ring }}
      >
        <CountdownRing countdown={countdown} font={font} />
      </Animated.View>
    </View>
  )
}

/** The button under the ring. Liquid Glass cannot fade its tint, so a grey
 *  pill lies over the cream button and fades off it. It pulses only after. */
export function FinishButton({
  label,
  finish,
  font,
  onPress,
}: {
  label: string
  finish: PauseFinish
  font: PauseFont
  onPress: () => void
}) {
  return (
    <View style={styles.buttonBox}>
      {finish.enabled ? (
        <Pulse delayMs={FINISH_MS - BUTTON_FROM_MS}>
          <PauseButton label={label} onPress={onPress} font={font} />
        </Pulse>
      ) : (
        <HeldPauseButton label={label} spokenLabel={label} font={font} />
      )}
      <Animated.View
        testID="pause-button-grey"
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.grey, { opacity: finish.grey }]}
      >
        <Text style={[styles.greyLabel, pauseText(font, pauseType.button)]}>
          {label}
        </Text>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  ringBox: {
    alignSelf: "stretch",
    height: pauseSizes.ringBoxHeight,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonBox: { alignSelf: "center" },
  grey: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: pauseRadii.button,
    backgroundColor: pauseColors.raised,
  },
  greyLabel: { color: pauseColors.muted, textAlign: "center" },
})

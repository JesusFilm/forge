// The Figma "Transition · Pray" screen (R11, R16, R17, R19, R30). The ring
// counts the pause down while Amen shows grey and takes no tap. At zero the
// ring fades out and Amen turns cream and takes taps. The screen opens with
// the intro in PauseIntro.
import { useEffect, useState } from "react"
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"

import { useCountdown } from "../../lib/dailyPause/countdown"
import type { Devotional } from "../../lib/dailyPause/devotionals"
import {
  PAUSE_TIMERS,
  type MeditationLength,
} from "../../lib/dailyPause/settings"
import {
  pauseColors,
  pauseRadii,
  pauseSizes,
  pauseSpacing,
  pauseType,
} from "../../lib/dailyPause/theme"
import { CountdownRing } from "./CountdownRing"
import {
  IntroContent,
  IntroCovered,
  IntroStepper,
  usePauseIntro,
} from "./PauseIntro"
import { Pulse } from "./Pulse"
import { sampledCurve } from "./sampledCurve"
import { StepperPills, type StepperStage } from "./StepperPills"
import { pauseText, type PauseFont } from "../../lib/dailyPause/fonts"
import { HeldPauseButton, PauseBody, PauseButton } from "./PauseFrame"
import { usePauseClock } from "./usePauseClock"

const AMEN = "Amen"

/** At zero the ring fades out over this time (the owner, 2026-10-07). */
export const PRAY_RING_FADE_MS = 500
/** Amen starts to turn cream, and takes taps, this long after zero. */
export const PRAY_AMEN_FROM_MS = 300
const AMEN_FADE_MS = 500
/** Amen is fully cream this long after zero. */
export const PRAY_FINISH_MS = PRAY_AMEN_FROM_MS + AMEN_FADE_MS

const easeInOut = Easing.inOut(Easing.cubic)
const easeOut = Easing.out(Easing.cubic)

/** The change at zero, on one clock: the ring fades out, then Amen's grey
 *  fades off. */
function usePrayFinish(done: boolean) {
  const { progress, reduceMotion } = usePauseClock(PRAY_FINISH_MS, done)
  const [amenDue, setAmenDue] = useState(false)
  const [levels] = useState(() => ({
    ring: sampledCurve(progress, {
      fromMs: 0,
      spanMs: PRAY_RING_FADE_MS,
      totalMs: PRAY_FINISH_MS,
      curve: (t) => 1 - easeInOut(t),
    }),
    amenGrey: sampledCurve(progress, {
      fromMs: PRAY_AMEN_FROM_MS,
      spanMs: AMEN_FADE_MS,
      totalMs: PRAY_FINISH_MS,
      curve: (t) => 1 - easeOut(t),
    }),
  }))

  // A native completion callback is unreliable on this app, so Amen takes
  // taps from its own clock.
  useEffect(() => {
    if (!done || reduceMotion) return
    const timer = setTimeout(() => setAmenDue(true), PRAY_AMEN_FROM_MS)
    return () => clearTimeout(timer)
  }, [done, reduceMotion])

  return { ...levels, amenEnabled: done && (reduceMotion || amenDue) }
}

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
  const finish = usePrayFinish(countdown.done)

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
        <View style={styles.ringGap} />
        <IntroContent intro={intro} style={styles.content}>
          <View style={styles.ringBox}>
            <Animated.View
              testID="pray-ring-fade"
              accessibilityElementsHidden={countdown.done}
              importantForAccessibility={
                countdown.done ? "no-hide-descendants" : "auto"
              }
              style={{ opacity: finish.ring }}
            >
              <CountdownRing countdown={countdown} font={font} />
            </Animated.View>
          </View>
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
        <View style={styles.amenBox}>
          {finish.amenEnabled ? (
            <Pulse delayMs={PRAY_FINISH_MS - PRAY_AMEN_FROM_MS}>
              <PauseButton label={AMEN} onPress={onContinue} font={font} />
            </Pulse>
          ) : (
            <HeldPauseButton label={AMEN} spokenLabel={AMEN} font={font} />
          )}
          {/* Liquid Glass cannot fade its tint, so a grey pill lies over the
              cream button and fades off it. */}
          <Animated.View
            testID="pray-amen-grey"
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.amenGrey, { opacity: finish.amenGrey }]}
          >
            <Text
              style={[styles.amenGreyLabel, pauseText(font, pauseType.button)]}
            >
              {AMEN}
            </Text>
          </Animated.View>
        </View>
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
  amenBox: { alignSelf: "center" },
  amenGrey: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: pauseRadii.button,
    backgroundColor: pauseColors.raised,
  },
  amenGreyLabel: { color: pauseColors.muted, textAlign: "center" },
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
  },
  attribution: {
    alignSelf: "stretch",
    color: pauseColors.accent,
  },
  buttonGap: { height: pauseSpacing.prayButtonGap },
})

// The intro of the Reflect and Pray screens (the owner, 2026-10-06). The
// stepper plays its arrival step at the center of the screen, then moves up to
// its place, then the content below it shows. The pause timer starts then.
import { useEffect, useState, type ReactNode } from "react"
import {
  Animated,
  Easing,
  StyleSheet,
  useWindowDimensions,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import {
  STEPPER_HEIGHT,
  stepperArrivalMs,
  type StepperStage,
} from "./StepperPills"
import { usePauseClock } from "./usePauseClock"
import { pauseBodyPadding } from "./WatchScreen"

/** The lit pill holds at the center before the stepper moves, in ms. */
const HOLD_MS = 300
const MOVE_MS = 600
/** The content starts to show this long before the stepper is in place. */
const CONTENT_LEAD_MS = 150
const CONTENT_MS = 500
/** The content rises this far as it shows, in points. */
const CONTENT_RISE = 12

type IntroArrival = Exclude<StepperStage, "watch">

function introTimes(arrival: IntroArrival) {
  const moveFrom = stepperArrivalMs(arrival) + HOLD_MS
  const contentFrom = moveFrom + MOVE_MS - CONTENT_LEAD_MS
  return { moveFrom, contentFrom, totalMs: contentFrom + CONTENT_MS }
}

/** When the content starts to show and the pause timer starts, in ms after
 *  the screen opens. Reflect and Pray have the same arrival step. */
export const PAUSE_INTRO_MS = introTimes("reflect").contentFrom

/** Points on each curve. The native driver rejects an `easing` key in an
 *  interpolation, so the curve rides in the ranges instead. */
const CURVE_POINTS = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]
const easeInOut = Easing.inOut(Easing.cubic)
const easeOut = Easing.out(Easing.cubic)

function curve(
  progress: Animated.Value,
  fromMs: number,
  spanMs: number,
  totalMs: number,
  output: (eased: number) => number,
  easing: (t: number) => number,
) {
  return progress.interpolate({
    inputRange: CURVE_POINTS.map((t) => (fromMs + t * spanMs) / totalMs),
    outputRange: CURVE_POINTS.map((t) => output(easing(t))),
    extrapolate: "clamp",
  })
}

export type PauseIntro = {
  /** True once the content shows. The pause timer runs from then. */
  shown: boolean
  stepperShift: Animated.AnimatedInterpolation<number>
  contentLevel: Animated.AnimatedInterpolation<number>
  contentRise: Animated.AnimatedInterpolation<number>
  /** The screen's scroll view, which clips the stepper. */
  onScrollLayout: (event: LayoutChangeEvent) => void
}

/** The intro clock. The screen's scroll view must be the first child of its
 *  `PauseBody`, with the stepper first in it, so the stepper's place is the
 *  top of the body. */
export function usePauseIntro(arrival: IntroArrival): PauseIntro {
  const window = useWindowDimensions()
  const padding = pauseBodyPadding(useSafeAreaInsets())
  const { moveFrom, contentFrom, totalMs } = introTimes(arrival)
  const { progress, reduceMotion } = usePauseClock(totalMs)
  const [timerDue, setTimerDue] = useState(false)
  const [scrollHeight, setScrollHeight] = useState<number | null>(null)

  // A native completion callback is unreliable on this app, so the pause
  // timer starts from its own clock, as the curtain does.
  useEffect(() => {
    if (reduceMotion) return
    const timer = setTimeout(() => setTimerDue(true), contentFrom)
    return () => clearTimeout(timer)
  }, [reduceMotion, contentFrom])

  const bodyHeight = window.height - padding.top - padding.bottom
  const centered = Math.max(0, (bodyHeight - STEPPER_HEIGHT) / 2)
  // Past the bottom of the scroll view the stepper would be cut off.
  const shiftFrom =
    scrollHeight == null
      ? centered
      : Math.min(centered, Math.max(0, scrollHeight - STEPPER_HEIGHT))

  const contentLevel = curve(
    progress,
    contentFrom,
    CONTENT_MS,
    totalMs,
    (eased) => eased,
    easeOut,
  )
  return {
    shown: reduceMotion || timerDue,
    stepperShift: curve(
      progress,
      moveFrom,
      MOVE_MS,
      totalMs,
      (eased) => shiftFrom * (1 - eased),
      easeInOut,
    ),
    contentLevel,
    contentRise: contentLevel.interpolate({
      inputRange: [0, 1],
      outputRange: [CONTENT_RISE, 0],
    }),
    onScrollLayout: (event) => setScrollHeight(event.nativeEvent.layout.height),
  }
}

/** The stepper's place: it starts at the center of the screen. */
export function IntroStepper({
  intro,
  children,
}: {
  intro: PauseIntro
  children: ReactNode
}) {
  return (
    <Animated.View
      testID="pause-intro-stepper"
      style={[
        styles.stepper,
        { transform: [{ translateY: intro.stepperShift }] },
      ]}
    >
      {children}
    </Animated.View>
  )
}

/** Content that shows after the stepper is in place. VoiceOver skips it
 *  until then. */
export function IntroContent({
  intro,
  style,
  children,
}: {
  intro: PauseIntro
  style?: StyleProp<ViewStyle>
  children: ReactNode
}) {
  return (
    <Animated.View
      testID="pause-intro-content"
      accessibilityElementsHidden={!intro.shown}
      importantForAccessibility={intro.shown ? "auto" : "no-hide-descendants"}
      style={[
        style,
        {
          opacity: intro.contentLevel,
          transform: [{ translateY: intro.contentRise }],
        },
      ]}
    >
      {children}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  stepper: { alignSelf: "stretch" },
})

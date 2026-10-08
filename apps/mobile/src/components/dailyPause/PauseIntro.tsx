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
import { pauseColors } from "../../lib/dailyPause/theme"
import { sampledCurve } from "./sampledCurve"
import { usePauseClock } from "./usePauseClock"
import { pauseBodyPadding } from "./PauseFrame"
import { TOP_ROW_HEIGHT } from "./useTopRowTop"

/** The lit pill holds at the center before the stepper moves, in ms. */
const HOLD_MS = 300
const MOVE_MS = 600
/** The content starts to show this long before the stepper is in place. */
const CONTENT_LEAD_MS = 150
const CONTENT_MS = 500
/** The content rises this far as it shows, in points. */
const CONTENT_RISE = 12
/** The stepper rests this far below the close's row. */
const STEPPER_ROW_GAP = 8

type IntroArrival = Exclude<StepperStage, "watch">

function introTimes(arrival: IntroArrival) {
  const moveFrom = stepperArrivalMs(arrival) + HOLD_MS
  const contentFrom = moveFrom + MOVE_MS - CONTENT_LEAD_MS
  return { moveFrom, contentFrom, totalMs: contentFrom + CONTENT_MS }
}

/** When the content starts to show and the pause timer starts, in ms after
 *  the screen opens. Reflect and Pray have the same arrival step. */
export const PAUSE_INTRO_MS = introTimes("reflect").contentFrom

const easeInOut = Easing.inOut(Easing.cubic)
const easeOut = Easing.out(Easing.cubic)

export type PauseIntro = {
  /** True once the content shows. The pause timer runs from then. */
  shown: boolean
  stepperShift: Animated.AnimatedInterpolation<number>
  contentLevel: Animated.AnimatedInterpolation<number>
  contentRise: Animated.AnimatedInterpolation<number>
  /** The cover over glass content: 1 hides it, 0 shows it. */
  coverLevel: Animated.AnimatedInterpolation<number>
  /** The stepper's place below the body's top: clear of the close's row. */
  stepperTop: number
  /** The screen's scroll view, which clips the stepper. */
  onScrollLayout: (event: LayoutChangeEvent) => void
}

/** The intro clock. The screen's scroll view must be the first child of its
 *  `PauseBody`, with the stepper first in it, so the stepper's place is
 *  `stepperTop` below the top of the body. */
export function usePauseIntro(arrival: IntroArrival): PauseIntro {
  const window = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const padding = pauseBodyPadding(insets)
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

  const stepperTop = Math.max(
    0,
    insets.top + TOP_ROW_HEIGHT + STEPPER_ROW_GAP - padding.top,
  )
  const bodyHeight = window.height - padding.top - padding.bottom
  const centered = Math.max(0, (bodyHeight - STEPPER_HEIGHT) / 2 - stepperTop)
  // Past the bottom of the scroll view the stepper would be cut off.
  const shiftFrom =
    scrollHeight == null
      ? centered
      : Math.min(
          centered,
          Math.max(0, scrollHeight - stepperTop - STEPPER_HEIGHT),
        )

  const contentLevel = sampledCurve(progress, {
    fromMs: contentFrom,
    spanMs: CONTENT_MS,
    totalMs,
    curve: easeOut,
  })
  return {
    shown: reduceMotion || timerDue,
    stepperShift: sampledCurve(progress, {
      fromMs: moveFrom,
      spanMs: MOVE_MS,
      totalMs,
      curve: (t) => shiftFrom * (1 - easeInOut(t)),
    }),
    contentLevel,
    contentRise: contentLevel.interpolate({
      inputRange: [0, 1],
      outputRange: [CONTENT_RISE, 0],
    }),
    coverLevel: contentLevel.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 0],
    }),
    stepperTop,
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
        {
          paddingTop: intro.stepperTop,
          transform: [{ translateY: intro.stepperShift }],
        },
      ]}
    >
      {children}
    </Animated.View>
  )
}

type IntroContentProps = {
  intro: PauseIntro
  style?: StyleProp<ViewStyle>
  children: ReactNode
}

/** Content that shows after the stepper is in place. VoiceOver skips it
 *  until then. */
export function IntroContent({ intro, style, children }: IntroContentProps) {
  return (
    <Animated.View
      testID="pause-intro-content"
      {...hiddenUntilShown(intro.shown)}
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

/** VoiceOver skips content until it shows. */
function hiddenUntilShown(shown: boolean) {
  return {
    accessibilityElementsHidden: !shown,
    importantForAccessibility: shown
      ? ("auto" as const)
      : ("no-hide-descendants" as const),
  }
}

/** IntroContent for Liquid Glass, which draws nothing under a fading
 *  ancestor. A cover in the ground's color fades off the content instead. */
export function IntroCovered({ intro, style, children }: IntroContentProps) {
  return (
    <Animated.View
      testID="pause-intro-covered"
      {...hiddenUntilShown(intro.shown)}
      style={[style, { transform: [{ translateY: intro.contentRise }] }]}
    >
      {children}
      <Animated.View
        testID="pause-intro-cover"
        pointerEvents="none"
        style={[styles.cover, { opacity: intro.coverLevel }]}
      />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  stepper: { alignSelf: "stretch" },
  cover: {
    ...StyleSheet.absoluteFill,
    backgroundColor: pauseColors.background,
  },
})

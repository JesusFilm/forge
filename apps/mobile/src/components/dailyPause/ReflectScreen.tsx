// The Figma "Transition · Reflect" screen (R11, R16-R18, R30). The button
// counts the pause down, takes no tap before 0:00, and then reads Continue.
// The verse scrolls at large text sizes, and the button stays on screen.
// The screen opens with the intro in PauseIntro, and the pause starts after.
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"

import {
  formatClock,
  spokenTimeLeft,
  useCountdown,
} from "../../lib/dailyPause/countdown"
import type { Devotional } from "../../lib/dailyPause/devotionals"
import {
  PAUSE_TIMERS,
  type MeditationLength,
} from "../../lib/dailyPause/settings"
import { pauseColors, pauseSpacing } from "../../lib/dailyPause/theme"
import {
  IntroContent,
  IntroCovered,
  IntroStepper,
  usePauseIntro,
} from "./PauseIntro"
import { Pulse } from "./Pulse"
import { StepperPills } from "./StepperPills"
import { PauseBody, PauseButton, type PauseFont } from "./WatchScreen"

const QUOTE_SIZE = 48
const QUOTE_LEADING = 36
/** Source Serif 4's own line height: (ascender 1036 + descender 335) / 1000. */
const BODY_LINE_RATIO = 1.371

/** The button reads this at 0:00. The timer before it keeps its width. */
const CONTINUE = "Continue"

/** A tap before the pause ends does nothing (R16). */
function ignoreTap() {}

type HeldPauseButtonProps = {
  label: string
  spokenLabel: string
  font: PauseFont
  widthLabel?: string
}

/** The frame's button while a pause timer runs. It looks the same, takes no
 *  tap, and VoiceOver reads it as a dimmed button with `spokenLabel`. */
export function HeldPauseButton({
  label,
  spokenLabel,
  font,
  widthLabel,
}: HeldPauseButtonProps) {
  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={spokenLabel}
      accessibilityState={{ disabled: true }}
      pointerEvents="none"
    >
      <PauseButton
        label={label}
        onPress={ignoreTap}
        font={font}
        widthLabel={widthLabel}
      />
    </View>
  )
}

type ReflectScreenProps = {
  /** The run's pinned devotional. */
  devotional: Devotional
  meditationLength: MeditationLength
  font: PauseFont
  onContinue: () => void
}

export function ReflectScreen({
  devotional,
  meditationLength,
  font,
  onContinue,
}: ReflectScreenProps) {
  const { fontScale } = useWindowDimensions()
  const intro = usePauseIntro("reflect")
  const countdown = useCountdown(
    PAUSE_TIMERS[meditationLength].reflectSec,
    intro.shown,
  )
  // iOS clips a glyph above a line box shorter than the face, so the mark
  // keeps the face's box. Equal negative margins give it the frame's 36 pt.
  const quoteTrim =
    ((QUOTE_SIZE * BODY_LINE_RATIO - QUOTE_LEADING) / 2) * fontScale

  return (
    <PauseBody>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        onLayout={intro.onScrollLayout}
      >
        <IntroStepper intro={intro}>
          <StepperPills arrival="reflect" font={font} />
        </IntroStepper>
        <View style={styles.spacer} />
        <IntroContent intro={intro} style={styles.content}>
          <Text
            style={[
              styles.quote,
              { marginVertical: -quoteTrim },
              font("bodyLight"),
            ]}
          >
            “
          </Text>
          <Text style={[styles.verse, font("bodyLightItalic")]}>
            {devotional.verse}
          </Text>
          <Text style={[styles.label, font("sansSemiBold")]}>
            {devotional.verseLabel}
          </Text>
          <Text style={[styles.waiting, font("bodyItalic")]}>
            We’ll give you some time.
          </Text>
        </IntroContent>
      </ScrollView>
      <IntroCovered intro={intro} style={styles.buttonRow}>
        {countdown.done ? (
          <Pulse>
            <PauseButton
              label={CONTINUE}
              onPress={onContinue}
              font={font}
              widthLabel={CONTINUE}
            />
          </Pulse>
        ) : (
          <HeldPauseButton
            label={formatClock(countdown.secondsLeft)}
            spokenLabel={`${CONTINUE}, ${spokenTimeLeft(countdown.secondsLeft)}`}
            font={font}
            widthLabel={CONTINUE}
          />
        )}
      </IntroCovered>
    </PauseBody>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1, alignSelf: "stretch" },
  // The spacer pushes the verse down onto the button, as in the frame.
  scrollContent: {
    flexGrow: 1,
    alignItems: "center",
    gap: pauseSpacing.screenGap,
  },
  spacer: { flex: 1 },
  content: {
    alignSelf: "stretch",
    alignItems: "center",
    gap: pauseSpacing.screenGap,
  },
  buttonRow: { alignSelf: "stretch", alignItems: "center" },
  quote: {
    color: pauseColors.accent,
    fontSize: QUOTE_SIZE,
  },
  verse: {
    alignSelf: "stretch",
    color: pauseColors.ink,
    fontSize: 17,
    lineHeight: 26,
  },
  label: {
    alignSelf: "stretch",
    color: pauseColors.accent,
    fontSize: 12,
    letterSpacing: 1.2,
  },
  waiting: {
    alignSelf: "stretch",
    color: pauseColors.muted,
    fontSize: 16,
  },
})

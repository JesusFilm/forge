// The Figma "Transition · Reflect" screen (R11, R16-R18, R30). The ring counts
// the pause down while Continue shows grey and takes no tap; the end is in
// PauseFinish (the owner, 2026-10-08). The verse scrolls at large text sizes,
// and the button stays on screen. The intro is in PauseIntro.
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"

import { useCountdown } from "../../lib/dailyPause/countdown"
import type { Devotional } from "../../lib/dailyPause/devotionals"
import {
  PAUSE_TIMERS,
  type MeditationLength,
} from "../../lib/dailyPause/settings"
import {
  pauseColors,
  pauseSpacing,
  pauseType,
} from "../../lib/dailyPause/theme"
import {
  IntroContent,
  IntroCovered,
  IntroStepper,
  usePauseIntro,
} from "./PauseIntro"
import { FinishButton, FinishRing, usePauseFinish } from "./PauseFinish"
import { StepperPills, type StepperStage } from "./StepperPills"
import { pauseText, type PauseFont } from "../../lib/dailyPause/fonts"
import { PauseBody } from "./PauseFrame"

const QUOTE_SIZE = 48
const QUOTE_LEADING = 36
/** Source Serif 4's own line height: (ascender 1036 + descender 335) / 1000. */
const BODY_LINE_RATIO = 1.371

const CONTINUE = "Continue"

type ReflectScreenProps = {
  /** The run's pinned devotional. */
  devotional: Devotional
  meditationLength: MeditationLength
  font: PauseFont
  onContinue: () => void
  /** Opens a section from a stepper pill. */
  onJump?: (stage: StepperStage) => void
}

export function ReflectScreen({
  devotional,
  meditationLength,
  font,
  onContinue,
  onJump,
}: ReflectScreenProps) {
  const { fontScale } = useWindowDimensions()
  const intro = usePauseIntro("reflect")
  const countdown = useCountdown(
    PAUSE_TIMERS[meditationLength].reflectSec,
    intro.shown,
  )
  const finish = usePauseFinish(countdown.done)
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
          <StepperPills arrival="reflect" font={font} onSelect={onJump} />
        </IntroStepper>
        <View style={styles.spacer} />
        <IntroContent intro={intro} style={styles.content}>
          <FinishRing countdown={countdown} finish={finish} font={font} />
          <Text
            style={[
              styles.quote,
              { marginVertical: -quoteTrim },
              font("bodyLight"),
            ]}
          >
            “
          </Text>
          <Text style={[styles.verse, pauseText(font, pauseType.reading)]}>
            {devotional.verse}
          </Text>
          <Text style={[styles.label, pauseText(font, pauseType.label)]}>
            {devotional.verseLabel}
          </Text>
          <Text style={[styles.waiting, pauseText(font, pauseType.note)]}>
            We’ll give you some time.
          </Text>
        </IntroContent>
      </ScrollView>
      <IntroCovered intro={intro} style={styles.buttonRow}>
        <FinishButton
          label={CONTINUE}
          finish={finish}
          font={font}
          onPress={onContinue}
        />
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
  // The body's own gap already sits above the button, so the margin adds
  // only the rest of the Reflect gap.
  buttonRow: {
    alignSelf: "stretch",
    alignItems: "center",
    marginTop: pauseSpacing.reflectButtonGap - pauseSpacing.screenGap,
    marginBottom: pauseSpacing.reflectButtonLift,
  },
  quote: {
    color: pauseColors.accent,
    fontSize: QUOTE_SIZE,
  },
  verse: {
    alignSelf: "stretch",
    color: pauseColors.ink,
  },
  label: {
    alignSelf: "stretch",
    color: pauseColors.accent,
  },
  waiting: {
    alignSelf: "stretch",
    color: pauseColors.muted,
  },
})

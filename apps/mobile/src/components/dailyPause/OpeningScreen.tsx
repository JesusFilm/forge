// The Figma "Opening" screen (R3, R31), with Resume and Start over in place of
// Begin Devotional when today was left part-way (R5, R6, KTD18). The question
// scrolls at large text sizes, and the actions stay on screen.
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"

import type { Devotional } from "../../lib/dailyPause/devotionals"
import {
  resumeTarget,
  type PauseDay,
  type PauseStep,
} from "../../lib/dailyPause/progress"
import type { MeditationLength } from "../../lib/dailyPause/settings"
import {
  pauseColors,
  pauseSpacing,
  pauseType,
} from "../../lib/dailyPause/theme"
import { pauseText, type PauseFont } from "../../lib/dailyPause/fonts"
import { PauseBody, PauseButton, PauseMasthead } from "./PauseFrame"

const QUESTION_SIZE = 48
const QUESTION_LEADING = 44
/** Instrument Serif's own line height: (ascender 990 + descender 310) / 1000. */
const DISPLAY_LINE_RATIO = 1.3

/** The drawn link is 15 pt tall; this makes its target 45 pt. */
const CUSTOMIZE_HIT_SLOP = { top: 15, bottom: 15, left: 8, right: 8 }

type OpeningScreenProps = {
  devotional: Devotional
  meditationLength: MeditationLength
  /** Today's saved progress. */
  day: PauseDay
  font: PauseFont
  onBegin(): void
  onResume(step: PauseStep): void
  onStartOver(): void
  onCustomize(): void
}

export function OpeningScreen({
  devotional,
  meditationLength,
  day,
  font,
  onBegin,
  onResume,
  onStartOver,
  onCustomize,
}: OpeningScreenProps) {
  const { fontScale } = useWindowDimensions()
  const resumeStep = resumeTarget(day)
  // iOS clips the first line's ascenders above a line box shorter than the
  // font, so the question gets that room inside its box and keeps its place.
  const headroom =
    (QUESTION_SIZE * DISPLAY_LINE_RATIO - QUESTION_LEADING) * fontScale

  return (
    <PauseBody>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        <PauseMasthead meditationLength={meditationLength} font={font} />
        <View style={styles.questionGap} />
        <Text
          style={[
            styles.question,
            { paddingTop: headroom, marginTop: -headroom },
            font("display"),
          ]}
        >
          {devotional.question}
        </Text>
      </ScrollView>
      {resumeStep === null ? (
        <PauseButton label="Begin Devotional" onPress={onBegin} font={font} />
      ) : (
        <View style={styles.choiceRow}>
          <PauseButton
            label="Resume"
            onPress={() => onResume(resumeStep)}
            font={font}
          />
          <PauseButton
            label="Start over"
            variant="outline"
            onPress={onStartOver}
            font={font}
          />
        </View>
      )}
      <Pressable
        onPress={onCustomize}
        accessibilityRole="button"
        accessibilityLabel="Customize experience"
        hitSlop={CUSTOMIZE_HIT_SLOP}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <Text style={[styles.customize, pauseText(font, pauseType.label)]}>
          CUSTOMIZE EXPERIENCE
        </Text>
      </Pressable>
    </PauseBody>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1, alignSelf: "stretch" },
  // The two equal Figma spacers center this group above the button.
  scrollContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: pauseSpacing.screenGap,
  },
  questionGap: { height: pauseSpacing.openingQuestionGap },
  question: {
    width: 258,
    maxWidth: "100%",
    color: pauseColors.ink,
    fontSize: QUESTION_SIZE,
    lineHeight: QUESTION_LEADING,
  },
  choiceRow: {
    alignSelf: "stretch",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: pauseSpacing.screenGap,
  },
  customize: {
    color: pauseColors.muted,
    textAlign: "center",
  },
  pressed: { opacity: 0.6 },
})

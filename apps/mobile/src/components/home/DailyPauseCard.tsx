import { useState } from "react"
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"

import { useTypography } from "../../hooks/useTypography"
import { useTextDirection } from "../../i18n/textDirection"
import { markTodaysDevotionalRead } from "../../lib/announcements"
import { hexToRgba } from "../../lib/color"
import { usePauseFonts } from "../../lib/dailyPause/fonts"
import { usePauseDay } from "../../lib/dailyPause/progress"
import {
  pauseColors,
  pauseRadii,
  pauseSpacing,
} from "../../lib/dailyPause/theme"
import { useToday } from "../../lib/dailyPause/today"
import { requestPause, usePausePhase } from "../../lib/pauseCurtain"
import {
  card as cardStyle,
  feedback,
  HORIZONTAL_PADDING,
  layout,
  text,
} from "../../styles/shared"
import { DailyBiblePauseLogo } from "../DailyBiblePauseLogo"
import { PauseLightLeaks } from "./PauseLightLeaks"

const HEADING = "Daily Bible Pause"
const BEGIN = "Begin today's pause"
/** R8. */
const DONE = "You paused today · Watch again"

/** A tablet gets one card of a phone-like size, not one very large card. */
export const DAILY_PAUSE_CARD_MAX_WIDTH = 600

/** The width between the shelf gutters, up to the tablet limit. */
export function dailyPauseCardWidth(screenWidth: number): number {
  return Math.min(
    screenWidth - 2 * HORIZONTAL_PADDING,
    DAILY_PAUSE_CARD_MAX_WIDTH,
  )
}

// Darkens the lower card so the cream question stays readable on the still.
const SCRIM_COLORS = [
  hexToRgba(pauseColors.background, 0),
  hexToRgba(pauseColors.background, 0.6),
  hexToRgba(pauseColors.background, 0.85),
] as const
const SCRIM_LOCATIONS = [0.2, 0.55, 1] as const

/** Home's entry to the Daily Bible Pause: a shelf heading over one card on a
 *  film still of the day's video. It shows today's question or the done state
 *  (R8). A tap reads the bell's announcement and opens the curtain. */
export function DailyPauseCard({ focused }: { focused: boolean }) {
  const { dayKey, devotional } = useToday()
  const curtainIdle = usePausePhase() === "idle"
  const { done } = usePauseDay(dayKey)
  const { ready, font } = usePauseFonts()
  const typography = useTypography()
  // The Pause is English-only until its localization pass.
  const heading = useTextDirection().text("en")
  const cardWidth = dailyPauseCardWidth(useWindowDimensions().width)

  return (
    <View style={[layout.sectionOuter, styles.section]}>
      <Text
        style={[
          text.sectionHeadingPadded,
          typography.titleSmall,
          heading.style,
        ]}
        accessibilityRole="header"
        accessibilityLanguage={heading.accessibilityLanguage}
      >
        {HEADING}
      </Text>
      <Pressable
        onPress={() => {
          markTodaysDevotionalRead()
          requestPause()
        }}
        accessibilityRole="button"
        accessibilityLabel={
          done
            ? "Daily Bible Pause. You paused today. Watch again"
            : `Daily Bible Pause. ${devotional.question} ${BEGIN}`
        }
        android_ripple={{ color: "rgba(255, 255, 255, 0.2)", foreground: true }}
        // 16:9 at the default text size; a larger text size makes it taller.
        style={({ pressed }) => [
          cardStyle.surface,
          styles.card,
          { width: cardWidth, minHeight: (cardWidth * 9) / 16 },
          pressed && Platform.OS === "ios" && feedback.pressed,
        ]}
      >
        <Image
          source={devotional.cardArt}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          recyclingKey={devotional.id}
          accessible={false}
        />
        <LinearGradient
          colors={SCRIM_COLORS}
          locations={SCRIM_LOCATIONS}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <PauseLightLeaks enabled={focused && curtainIdle} />
        <CardLogo />
        {ready ? (
          done ? (
            <View style={styles.doneRow}>
              <Text style={[styles.check, font("sansBold")]}>✓</Text>
              <Text style={[styles.headline, styles.doneCopy, font("display")]}>
                {DONE}
              </Text>
            </View>
          ) : (
            <View style={styles.body}>
              <Text
                style={[styles.headline, font("display")]}
                numberOfLines={3}
              >
                {devotional.question}
              </Text>
              <View style={styles.button}>
                <Text style={[styles.buttonLabel, font("sansSemiBold")]}>
                  {BEGIN}
                </Text>
              </View>
            </View>
          )
        ) : null}
      </Pressable>
    </View>
  )
}

/** The logo's mark, fully drawn at its curtain size, centred in the space
 *  above the card's text. The heading above the card names it. */
function CardLogo() {
  const [draw] = useState(() => new Animated.Value(1))
  return (
    <View
      style={styles.logoArea}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <DailyBiblePauseLogo draw={draw} title={false} />
    </View>
  )
}

const styles = StyleSheet.create({
  section: { paddingVertical: 8 },
  card: {
    marginLeft: HORIZONTAL_PADDING,
    padding: 20,
    rowGap: pauseSpacing.screenGap,
    justifyContent: "space-between",
    backgroundColor: pauseColors.background,
  },
  logoArea: {
    flex: 1,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
  },
  // Every element sits on the card's centre line, under the centred logo.
  body: { gap: pauseSpacing.screenGap, alignItems: "center" },
  headline: {
    color: pauseColors.ink,
    fontSize: 28,
    lineHeight: 30,
    textAlign: "center",
  },
  doneRow: {
    flexDirection: "row",
    alignItems: "baseline",
    alignSelf: "center",
    gap: 10,
  },
  check: { color: pauseColors.accent, fontSize: 20 },
  doneCopy: { flexShrink: 1 },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: pauseRadii.button,
    backgroundColor: pauseColors.ink,
  },
  buttonLabel: {
    color: pauseColors.background,
    fontSize: 16,
  },
})

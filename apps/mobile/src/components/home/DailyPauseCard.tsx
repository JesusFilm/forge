import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"

import { markTodaysDevotionalRead } from "../../lib/announcements"
import { usePauseFonts } from "../../lib/dailyPause/fonts"
import { usePauseDay } from "../../lib/dailyPause/progress"
import {
  pauseColors,
  pauseRadii,
  pauseSpacing,
} from "../../lib/dailyPause/theme"
import { useToday } from "../../lib/dailyPause/today"
import { requestPause } from "../../lib/pauseCurtain"

const EYEBROW = "DAILY BIBLE PAUSE"
const BEGIN = "Begin today's pause"
/** R8. */
const DONE = "You paused today · Watch again"

/** Home's entry to the Daily Bible Pause: today's question, or the quiet done
 *  state (R8). A tap reads the bell's announcement and opens the curtain. */
export function DailyPauseCard() {
  const { dayKey, devotional } = useToday()
  const { done } = usePauseDay(dayKey)
  const { ready, font } = usePauseFonts()
  const { width } = useWindowDimensions()

  return (
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
      // 16:9 at the default text size; a larger text size makes it taller.
      style={({ pressed }) => [
        styles.card,
        { minHeight: (width * 9) / 16 },
        pressed && styles.pressed,
      ]}
    >
      {ready ? (
        <>
          <Text style={[styles.eyebrow, font("sansMedium")]}>{EYEBROW}</Text>
          {done ? (
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
          )}
        </>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    paddingHorizontal: pauseSpacing.screenSide,
    paddingVertical: 20,
    gap: pauseSpacing.screenGap,
    justifyContent: "space-between",
    backgroundColor: pauseColors.background,
  },
  pressed: { opacity: 0.85 },
  eyebrow: {
    color: pauseColors.ink,
    fontSize: 12,
    letterSpacing: 2.6,
  },
  body: { gap: pauseSpacing.screenGap, alignItems: "flex-start" },
  headline: {
    color: pauseColors.ink,
    fontSize: 28,
    lineHeight: 30,
  },
  doneRow: { flexDirection: "row", alignItems: "baseline", gap: 10 },
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

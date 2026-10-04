import { Pressable, StyleSheet, Text, View } from "react-native"
import { LinearGradient } from "expo-linear-gradient"
import Ionicons from "@expo/vector-icons/Ionicons"

import {
  ACCENT,
  BG_COLOR,
  QUIZ_GRADIENT,
  TEXT_BODY,
  TEXT_PRIMARY,
  hexToRgba,
} from "../../lib/color"
import { markTodaysDevotionalRead } from "../../lib/announcements"
import { requestPause } from "../../lib/pauseCurtain"
import { HORIZONTAL_PADDING } from "../../styles/shared"

/** Home's entry to the Daily Bible Pause: a full-width 16:9 invitation that
 *  opens the curtain and reads today's announcement. A mockup, lightly styled. */
export function DailyPauseCard() {
  return (
    <Pressable
      onPress={() => {
        markTodaysDevotionalRead()
        requestPause()
      }}
      accessibilityRole="button"
      accessibilityLabel="Begin today's Daily Bible Pause"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <LinearGradient
        colors={[
          hexToRgba(QUIZ_GRADIENT[0], 0.55),
          hexToRgba(ACCENT, 0.3),
          hexToRgba(BG_COLOR, 1),
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Text style={styles.eyebrow}>DAILY BIBLE PAUSE</Text>
      <View style={styles.body}>
        <Text style={styles.title}>Take a quiet minute with God</Text>
        <Text style={styles.copy}>
          Today&apos;s devotional is ready for you. Breathe, listen, and
          reflect.
        </Text>
        <View style={styles.cta}>
          <Ionicons name="play" size={14} color={BG_COLOR} />
          <Text style={styles.ctaLabel}>Begin today&apos;s pause</Text>
        </View>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    aspectRatio: 16 / 9,
    padding: HORIZONTAL_PADDING + 4,
    justifyContent: "space-between",
    overflow: "hidden",
    backgroundColor: BG_COLOR,
  },
  pressed: { opacity: 0.85 },
  eyebrow: {
    color: TEXT_BODY,
    fontFamily: "System",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 3,
  },
  body: { gap: 8 },
  title: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 24,
    fontWeight: "700",
  },
  copy: {
    color: TEXT_BODY,
    fontFamily: "System",
    fontSize: 15,
    lineHeight: 20,
  },
  cta: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: TEXT_PRIMARY,
  },
  ctaLabel: {
    color: BG_COLOR,
    fontFamily: "System",
    fontSize: 14,
    fontWeight: "600",
  },
})

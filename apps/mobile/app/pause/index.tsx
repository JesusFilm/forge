import { Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useCloseDailyPause } from "../../src/components/dailyPause/DailyPauseHost"
import { usePauseSettings } from "../../src/lib/dailyPause/settings"
import { pauseColors, pauseSpacing } from "../../src/lib/dailyPause/theme"
import { useToday } from "../../src/lib/dailyPause/today"

/** A minimal Opening (R3) that the curtain reveals. The run screen replaces it. */
export default function DailyPauseRunScreen() {
  const insets = useSafeAreaInsets()
  const close = useCloseDailyPause()
  const { devotional } = useToday()
  const { meditationLength } = usePauseSettings()

  return (
    <View
      style={[
        styles.screen,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <Pressable
        onPress={close}
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={({ pressed }) => [styles.close, pressed && styles.pressed]}
      >
        <Ionicons name="close" size={24} color={pauseColors.muted} />
      </Pressable>
      <View style={styles.body}>
        <Text style={styles.minutes}>{`– ${meditationLength} min –`}</Text>
        <Text style={styles.question}>{devotional.question}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: pauseColors.background },
  close: {
    width: 44,
    height: 44,
    marginLeft: pauseSpacing.screenSide - 10,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.6 },
  body: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: pauseSpacing.screenSide,
    gap: pauseSpacing.screenGap,
  },
  minutes: {
    color: pauseColors.accent,
    fontSize: 15,
    textAlign: "center",
  },
  question: {
    color: pauseColors.ink,
    fontSize: 30,
    lineHeight: 38,
    textAlign: "center",
  },
})

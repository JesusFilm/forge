import { Pressable, StyleSheet, Text, View } from "react-native"
import { useRouter } from "expo-router"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useTypography } from "../../hooks/useTypography"
import {
  ACCENT,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../../lib/color"
import { feedback } from "../../styles/shared"

const ICON_WRAP_SIZE = 84

/** R17: only rendered once the persisted manifest has hydrated and holds zero records. */
export function LibraryEmptyState() {
  const typography = useTypography()
  const router = useRouter()

  return (
    <View style={styles.root}>
      <View style={styles.iconWrap}>
        <Ionicons
          name="arrow-down-circle-outline"
          size={38}
          color={TEXT_SECONDARY}
        />
      </View>
      <Text style={[styles.heading, typography.titleLarge]}>
        No downloads yet
      </Text>
      <Text style={[styles.body, typography.body]}>
        Videos you download will appear here so you can watch them anywhere —
        even offline.
      </Text>
      <Pressable
        onPress={() => router.navigate("/(tabs)/watch")}
        style={({ pressed }) => [styles.button, pressed && feedback.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Browse videos"
      >
        <Text style={[styles.buttonText, typography.body]}>Browse videos</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    paddingTop: 110,
    paddingHorizontal: 36,
  },
  iconWrap: {
    width: ICON_WRAP_SIZE,
    height: ICON_WRAP_SIZE,
    borderRadius: 26,
    backgroundColor: SURFACE_COLOR,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
  },
  heading: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "800",
    textAlign: "center",
  },
  body: {
    marginTop: 9,
    color: TEXT_SECONDARY,
    fontFamily: "System",
    textAlign: "center",
  },
  button: {
    marginTop: 22,
    height: 44,
    borderRadius: 22,
    paddingHorizontal: 24,
    backgroundColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "600",
  },
})

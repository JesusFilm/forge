import { Platform, Pressable, StyleSheet, View } from "react-native"
import { LinearGradient } from "expo-linear-gradient"
import { BlurView } from "expo-blur"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useRouter } from "expo-router"

import {
  ACCENT,
  BLACK,
  SURFACE_COLOR,
  TEXT_SECONDARY,
  hexToRgba,
} from "../../lib/color"
import { HORIZONTAL_PADDING } from "../../styles/shared"

export function HomeHeader() {
  const insets = useSafeAreaInsets()
  const router = useRouter()

  return (
    <View style={[styles.container, { paddingTop: insets.top + 4 }]}>
      <LinearGradient
        colors={[hexToRgba(BLACK, 0.5), hexToRgba(BLACK, 0)]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Search"
        onPress={() => router.navigate("/(tabs)/watch")}
      >
        <BlurView
          style={styles.glassButton}
          intensity={40}
          tint="dark"
        >
          <Ionicons name="search" size={22} color={ACCENT} />
        </BlurView>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Profile"
        onPress={() => router.navigate("/(tabs)/profile")}
      >
        <BlurView
          style={styles.glassButton}
          intensity={40}
          tint="dark"
        >
          <Ionicons name="person" size={16} color={TEXT_SECONDARY} />
        </BlurView>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingBottom: 8,
  },
  glassButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      android: {
        backgroundColor: hexToRgba(SURFACE_COLOR, 0.6),
        overflow: "hidden" as const,
      },
    }),
  },
})

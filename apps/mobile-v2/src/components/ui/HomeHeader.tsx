import { Platform, Pressable, StyleSheet, View } from "react-native"
import { LinearGradient } from "expo-linear-gradient"
import { GlassView } from "expo-glass-effect"
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
        <GlassView
          style={styles.glassButton}
          glassEffectStyle="regular"
          colorScheme="dark"
        >
          <Ionicons name="search" size={22} color={ACCENT} />
        </GlassView>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Profile"
        onPress={() => router.navigate("/(tabs)/profile")}
      >
        <GlassView
          style={styles.glassButton}
          glassEffectStyle="regular"
          colorScheme="dark"
        >
          <Ionicons name="person" size={16} color={TEXT_SECONDARY} />
        </GlassView>
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
    paddingHorizontal: 16,
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

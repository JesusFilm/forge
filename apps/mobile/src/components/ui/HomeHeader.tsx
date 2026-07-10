import { Platform, Pressable, StyleSheet, Text, View } from "react-native"
import { LinearGradient } from "expo-linear-gradient"
import { GlassView } from "expo-glass-effect"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useRouter } from "expo-router"

import {
  ACCENT,
  BLACK,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  hexToRgba,
} from "../../lib/color"
import { HORIZONTAL_PADDING } from "../../styles/shared"

type HomeHeaderProps = {
  title: string | null
  titleOpacity: number
  /**
   * Home-tab variant: search + profile grouped right, left slot empty. Default
   * (Experience screens) keeps the original layout — search left, profile right.
   */
  homeVariant?: boolean
}

export function HomeHeader({
  title,
  titleOpacity,
  homeVariant = false,
}: HomeHeaderProps) {
  const insets = useSafeAreaInsets()
  const router = useRouter()

  const searchButton = (
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
  )

  const profileButton = (
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
        <Ionicons name="person" size={16} color={ACCENT} />
      </GlassView>
    </Pressable>
  )

  return (
    <View style={[styles.container, { paddingTop: insets.top + 4 }]}>
      <LinearGradient
        colors={[hexToRgba(BLACK, 0.5), hexToRgba(BLACK, 0)]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {homeVariant ? <View /> : searchButton}

      {title != null && titleOpacity > 0 && (
        <GlassView
          style={[styles.glassPill, { opacity: titleOpacity }]}
          glassEffectStyle="regular"
          colorScheme="dark"
        >
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </GlassView>
      )}

      {homeVariant ? (
        <View style={styles.buttonRow}>
          {searchButton}
          {profileButton}
        </View>
      ) : (
        profileButton
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingBottom: 8,
  },
  buttonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  glassPill: {
    flexShrink: 1,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    ...Platform.select({
      android: {
        backgroundColor: hexToRgba(SURFACE_COLOR, 0.6),
        overflow: "hidden" as const,
      },
    }),
  },
  title: {
    color: TEXT_PRIMARY,
    fontSize: 17,
    fontWeight: "600",
    fontFamily: "System",
    textAlign: "center",
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

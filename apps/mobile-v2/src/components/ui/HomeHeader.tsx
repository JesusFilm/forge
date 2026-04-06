import { Pressable, StyleSheet, Text, View } from "react-native"
import { LinearGradient } from "expo-linear-gradient"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { hexToRgba } from "../../lib/color"

interface HomeHeaderProps {
  title?: string
}

export function HomeHeader({ title = "Curated" }: HomeHeaderProps) {
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.container, { paddingTop: insets.top + 4 }]}>
      <LinearGradient
        colors={[hexToRgba("#000000", 0.5), hexToRgba("#000000", 0)]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <Pressable
        style={styles.iconButton}
        accessibilityRole="button"
        accessibilityLabel="Search"
      >
        <Ionicons name="search" size={22} color="#CB333B" />
      </Pressable>

      <Text style={styles.title}>{title}</Text>

      <Pressable
        style={styles.iconButton}
        accessibilityRole="button"
        accessibilityLabel="Profile"
      >
        <View style={styles.avatar}>
          <Ionicons name="person" size={16} color="#a8a29e" />
        </View>
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
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    color: "#f5f5f4",
    fontFamily: "System",
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#292524",
    alignItems: "center",
    justifyContent: "center",
  },
})

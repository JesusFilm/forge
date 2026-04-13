import { useState } from "react"
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"

const { height: SCREEN_HEIGHT } = Dimensions.get("window")
const HERO_HEIGHT = SCREEN_HEIGHT * 0.55

/** Crimson Gallery design tokens */
const COLORS = {
  surface: "#161311",
  surfaceContainer: "#221F1D",
  primary: "#CB333B",
  text: "#F5F5F4",
  muted: "#A8A29E",
} as const

/** hexToRgba — never use "transparent" (causes flicker on Android TV). */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

type HomeHeroProps = {
  title: string
  subtitle?: string
  imageUrl?: string | null
  onExplore?: () => void
}

export function HomeHero({
  title,
  subtitle,
  imageUrl,
  onExplore,
}: HomeHeroProps) {
  const [exploreFocused, setExploreFocused] = useState(false)

  return (
    <View style={styles.container}>
      {imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          recyclingKey={`hero-${imageUrl}`}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallbackBg]} />
      )}

      {/* Smooth gradient fade into background */}
      <LinearGradient
        colors={[hexToRgba(COLORS.surface, 0), COLORS.surface]}
        locations={[0.4, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Text overlay */}
      <View style={styles.textContainer}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
        {onExplore ? (
          <Pressable
            onPress={onExplore}
            onFocus={() => setExploreFocused(true)}
            onBlur={() => setExploreFocused(false)}
            style={[
              styles.exploreButton,
              exploreFocused && styles.exploreButtonFocused,
            ]}
            hasTVPreferredFocus
          >
            <Text style={styles.exploreText}>Explore</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: HERO_HEIGHT,
    position: "relative",
    overflow: "hidden",
  },
  fallbackBg: {
    backgroundColor: COLORS.surfaceContainer,
  },
  textContainer: {
    position: "absolute",
    bottom: 48,
    left: 80,
    right: 80,
  },
  title: {
    fontFamily: "System",
    fontSize: 44,
    fontWeight: "bold",
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: "System",
    fontSize: 20,
    color: COLORS.muted,
    marginTop: 8,
  },
  exploreButton: {
    marginTop: 20,
    alignSelf: "flex-start",
    backgroundColor: COLORS.primary,
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 8,
  },
  exploreButtonFocused: {
    transform: [{ scale: 1.05 }],
    shadowColor: COLORS.primary,
    shadowRadius: 20,
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 0 },
  },
  exploreText: {
    fontFamily: "System",
    fontSize: 20,
    fontWeight: "600",
    color: COLORS.text,
  },
})

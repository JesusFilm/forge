import { Dimensions, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"

const { height: SCREEN_HEIGHT } = Dimensions.get("window")
const HERO_HEIGHT = SCREEN_HEIGHT * 0.55

/** Crimson Gallery design tokens */
const COLORS = {
  surface: "#161311",
  surfaceContainer: "#221F1D",
  text: "#F5F5F4",
  muted: "#A8A29E",
} as const

type HomeHeroProps = {
  title: string
  subtitle?: string
  imageUrl?: string | null
}

export function HomeHero({ title, subtitle, imageUrl }: HomeHeroProps) {
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

      {/* Gradient overlay: only show over images, not fallback */}
      {imageUrl != null && (
        <>
          <View style={styles.gradientTop} />
          <View style={styles.gradientBottom} />
        </>
      )}

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
  gradientTop: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: HERO_HEIGHT * 0.4,
    height: HERO_HEIGHT * 0.3,
    backgroundColor: COLORS.surface,
    opacity: 0.3,
  },
  gradientBottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: HERO_HEIGHT * 0.5,
    backgroundColor: COLORS.surface,
    opacity: 0.85,
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
})

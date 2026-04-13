import { useEffect, useState } from "react"
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { useVideoPlayer, VideoView } from "expo-video"

import { COLORS, hexToRgba } from "../lib/colors"
import { validateStreamingUrl } from "../lib/validateUrl"

const { height: SCREEN_HEIGHT } = Dimensions.get("window")
const HERO_HEIGHT = SCREEN_HEIGHT * 0.55

type HomeHeroProps = {
  title: string
  subtitle?: string
  imageUrl?: string | null
  streamingUrl?: string | null
  onExplore?: () => void
}

export function HomeHero({
  title,
  subtitle,
  imageUrl,
  streamingUrl,
  onExplore,
}: HomeHeroProps) {
  const [exploreFocused, setExploreFocused] = useState(false)

  const hasValidStream =
    typeof streamingUrl === "string" && validateStreamingUrl(streamingUrl)

  // Inline autoplay: muted, looping background video
  const player = useVideoPlayer(hasValidStream ? streamingUrl : null, (p) => {
    p.muted = true
    p.loop = true
  })

  // Auto-play on mount (separate effect — required for tvOS)
  useEffect(() => {
    if (hasValidStream) {
      try {
        player.play()
      } catch {
        // Native player already released
      }
    }
  }, [player, hasValidStream])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        player.pause()
      } catch {
        // Native player already released
      }
    }
  }, [player])

  return (
    <View style={styles.container}>
      {/* Background: video when available, else image, else solid color */}
      {hasValidStream ? (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          nativeControls={false}
          contentFit="cover"
        />
      ) : imageUrl ? (
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

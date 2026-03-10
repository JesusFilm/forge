import { useState } from "react"
import { useEvent } from "expo"
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native"
import { useVideoPlayer, VideoView } from "expo-video"

import type { VideoHeroSection } from "../../lib/sectionModels"

export interface VideoHeroRendererProps {
  section: VideoHeroSection
}

export function VideoHeroRenderer({ section }: VideoHeroRendererProps) {
  const { heading, subheading, ctaLabel, ctaLink, streamingUrl, video } =
    section
  const thumbnailUrl = video.image?.url ?? null
  const trimmedCtaLabel = ctaLabel?.trim() || null
  const trimmedCtaLink = ctaLink?.trim() || null
  const hasCta = trimmedCtaLabel != null && trimmedCtaLink != null

  const [hasStarted, setHasStarted] = useState(false)

  const player = useVideoPlayer(streamingUrl ?? null, (p) => {
    p.loop = false
  })

  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  })

  const handleCtaPress = () => {
    if (trimmedCtaLink) {
      void Linking.openURL(trimmedCtaLink)
    }
  }

  const handlePlayPress = () => {
    if (player) {
      player.play()
      setHasStarted(true)
    }
  }

  const handlePausePress = () => {
    if (player) {
      player.pause()
    }
  }

  return (
    <View style={styles.container}>
      {streamingUrl ? (
        <>
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            nativeControls={false}
            contentFit="cover"
          />
          {!hasStarted && thumbnailUrl && (
            <Image
              source={{ uri: thumbnailUrl }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              accessibilityLabel={
                video.image?.alternativeText ?? `${video.title} thumbnail`
              }
            />
          )}
          {/* Play/pause overlay */}
          <Pressable
            style={styles.playPauseOverlay}
            onPress={isPlaying ? handlePausePress : handlePlayPress}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? "Pause video" : "Play video"}
          >
            {!isPlaying && (
              <View style={styles.playButton}>
                <Text style={styles.playIcon}>▶</Text>
              </View>
            )}
          </Pressable>
        </>
      ) : thumbnailUrl ? (
        <Image
          source={{ uri: thumbnailUrl }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          accessibilityLabel={
            video.image?.alternativeText ?? `${video.title} thumbnail`
          }
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallbackBackground]} />
      )}

      <View style={styles.overlay}>
        {heading != null && (
          <Text
            style={styles.heading}
            accessibilityRole="header"
            numberOfLines={3}
          >
            {heading}
          </Text>
        )}
        {subheading != null && (
          <Text style={styles.subheading} numberOfLines={2}>
            {subheading}
          </Text>
        )}
        {hasCta && (
          <Pressable
            style={({ pressed }: { pressed: boolean }) => [
              styles.ctaButton,
              pressed && styles.ctaButtonPressed,
            ]}
            onPress={handleCtaPress}
            accessibilityRole="link"
            accessibilityLabel={trimmedCtaLabel}
          >
            <Text style={styles.ctaText}>{trimmedCtaLabel}</Text>
          </Pressable>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    minHeight: 400,
    justifyContent: "flex-end",
  },
  fallbackBackground: {
    backgroundColor: "#1c1917",
  },
  playPauseOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  playButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  playIcon: {
    fontSize: 28,
    color: "#ffffff",
    marginLeft: 4,
  },
  overlay: {
    padding: 24,
    paddingBottom: 32,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  heading: {
    fontSize: 32,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 4,
  },
  subheading: {
    fontSize: 14,
    fontWeight: "400",
    color: "rgba(255, 255, 255, 0.7)",
    textTransform: "uppercase",
    letterSpacing: 2,
    marginTop: 4,
  },
  ctaButton: {
    marginTop: 16,
    alignSelf: "flex-start",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 6,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
  },
  ctaButtonPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.35)",
  },
  ctaText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
  },
})

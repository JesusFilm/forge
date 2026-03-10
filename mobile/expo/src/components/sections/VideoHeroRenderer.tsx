import { useState } from "react"
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

  const [isPlaying, setIsPlaying] = useState(false)

  const player = useVideoPlayer(streamingUrl ?? "", (p) => {
    p.loop = false
  })

  const handleCtaPress = () => {
    if (trimmedCtaLink) {
      void Linking.openURL(trimmedCtaLink)
    }
  }

  const handlePlayPress = () => {
    if (player) {
      player.play()
      setIsPlaying(true)
    }
  }

  const handlePausePress = () => {
    if (player) {
      player.pause()
      setIsPlaying(false)
    }
  }

  return (
    // @ts-expect-error React 19 vs RN component types
    <View style={styles.container}>
      {streamingUrl ? (
        <>
          {/* @ts-expect-error React 19 vs RN component types */}
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            nativeControls={false}
            contentFit="cover"
          />
          {/* Play/pause overlay */}
          {/* @ts-expect-error React 19 vs RN component types */}
          <Pressable
            style={styles.playPauseOverlay}
            onPress={isPlaying ? handlePausePress : handlePlayPress}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? "Pause video" : "Play video"}
          >
            {!isPlaying && (
              // @ts-expect-error React 19 vs RN component types
              <View style={styles.playButton}>
                {/* @ts-expect-error RN Text vs React 19 ReactNode */}
                <Text style={styles.playIcon}>▶</Text>
              </View>
            )}
          </Pressable>
        </>
      ) : thumbnailUrl ? (
        // @ts-expect-error React 19 vs RN component types
        <Image
          source={{ uri: thumbnailUrl }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          accessibilityLabel={
            video.image?.alternativeText ?? `${video.title} thumbnail`
          }
        />
      ) : (
        // @ts-expect-error React 19 vs RN component types
        <View style={[StyleSheet.absoluteFill, styles.fallbackBackground]} />
      )}

      {/* @ts-expect-error React 19 vs RN component types */}
      <View style={styles.overlay}>
        {/* @ts-expect-error RN Text vs React 19 ReactNode */}
        {heading != null && (
          <Text
            style={styles.heading}
            accessibilityRole="header"
            numberOfLines={3}
          >
            {heading}
          </Text>
        )}
        {/* @ts-expect-error RN Text vs React 19 ReactNode */}
        {subheading != null && (
          <Text style={styles.subheading} numberOfLines={2}>
            {subheading}
          </Text>
        )}
        {hasCta && (
          // @ts-expect-error React 19 vs RN component types
          <Pressable
            style={({ pressed }: { pressed: boolean }) => [
              styles.ctaButton,
              pressed && styles.ctaButtonPressed,
            ]}
            onPress={handleCtaPress}
            accessibilityRole="link"
            accessibilityLabel={trimmedCtaLabel}
          >
            {/* @ts-expect-error RN Text vs React 19 ReactNode */}
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

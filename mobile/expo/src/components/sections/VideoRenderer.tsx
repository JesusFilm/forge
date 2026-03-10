import { useState } from "react"
import { Image, Pressable, StyleSheet, Text, View } from "react-native"
import { useVideoPlayer, VideoView } from "expo-video"

import type { VideoSection } from "../../lib/sectionModels"

export interface VideoRendererProps {
  section: VideoSection
}

export function VideoRenderer({ section }: VideoRendererProps) {
  const { title, subtitle, streamingUrl, media, video } = section
  const thumbnailUrl = media?.url ?? video?.image?.url ?? null
  const thumbnailAlt =
    media?.alternativeText ?? video?.image?.alternativeText ?? title ?? "Video"

  const [isPlaying, setIsPlaying] = useState(false)

  const player = useVideoPlayer(streamingUrl, (p) => {
    p.loop = false
  })

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
      {/* @ts-expect-error React 19 vs RN component types */}
      <View style={styles.playerContainer}>
        {isPlaying ? (
          <>
            {/* @ts-expect-error React 19 vs RN component types */}
            <VideoView
              player={player}
              style={StyleSheet.absoluteFill}
              nativeControls
              allowsFullscreen
              allowsPictureInPicture
              contentFit="contain"
            />
            {/* @ts-expect-error React 19 vs RN component types */}
            <Pressable
              style={styles.pauseOverlay}
              onPress={handlePausePress}
              accessibilityRole="button"
              accessibilityLabel="Pause video"
            />
          </>
        ) : (
          // @ts-expect-error React 19 vs RN component types
          <Pressable
            style={styles.posterContainer}
            onPress={handlePlayPress}
            accessibilityRole="button"
            accessibilityLabel={`Play ${title ?? "video"}`}
          >
            {thumbnailUrl ? (
              // @ts-expect-error React 19 vs RN component types
              <Image
                source={{ uri: thumbnailUrl }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
                accessibilityLabel={thumbnailAlt}
              />
            ) : (
              // @ts-expect-error React 19 vs RN component types
              <View style={[StyleSheet.absoluteFill, styles.placeholder]} />
            )}
            {/* @ts-expect-error React 19 vs RN component types */}
            <View style={styles.playButtonOverlay}>
              {/* @ts-expect-error RN Text vs React 19 ReactNode */}
              <Text style={styles.playIcon} accessibilityElementsHidden>
                ▶
              </Text>
            </View>
          </Pressable>
        )}
      </View>
      {title != null && (
        // @ts-expect-error RN Text vs React 19 ReactNode
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
      )}
      {subtitle != null && (
        // @ts-expect-error RN Text vs React 19 ReactNode
        <Text style={styles.subtitle} numberOfLines={2}>
          {subtitle}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
    paddingHorizontal: 16,
  },
  playerContainer: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#1c1917",
    justifyContent: "center",
    alignItems: "center",
  },
  posterContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  pauseOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  placeholder: {
    backgroundColor: "#292524",
  },
  playButtonOverlay: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  playIcon: {
    fontSize: 22,
    color: "#ffffff",
    marginLeft: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
    marginTop: 12,
  },
  subtitle: {
    fontSize: 14,
    color: "#666666",
    marginTop: 4,
  },
})

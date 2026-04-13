import { useEffect } from "react"
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { useVideoPlayer, VideoView } from "expo-video"

import type { NormalizedBlock } from "../../lib/normalizer"
import { resolveImageUrl, getMuxThumbnailUrl } from "../../lib/resolveImageUrl"
import { pickThumbnailUrl } from "../../lib/types"
import { useVideoPlayerContext } from "../../contexts/VideoPlayerContext"
import { validateStreamingUrl } from "../../lib/validateUrl"

// ── Constants ────────────────────────────────────────────────────────────────

const { height: SCREEN_HEIGHT } = Dimensions.get("window")
const HERO_HEIGHT = SCREEN_HEIGHT * 0.55

const COLORS = {
  surface: "#161311",
  surfaceContainer: "#221F1D",
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

// ── Types ────────────────────────────────────────────────────────────────────

export interface VideoHeroRendererProps {
  section: NormalizedBlock
}

// ── Component ────────────────────────────────────────────────────────────────

export function VideoHeroRenderer({ section }: VideoHeroRendererProps) {
  const { playVideo } = useVideoPlayerContext()
  const heading = section.heading as string | null
  const subheading = section.subheading as string | null
  const streamingUrl = section.streamingUrl as string | null | undefined

  const video = section.video as
    | {
        documentId?: string
        title?: string
        slug?: string
        images?: {
          url?: string
          mobileCinematicHigh?: string
          videoStill?: string
        }
      }
    | null
    | undefined

  const hasValidStream = validateStreamingUrl(streamingUrl)
  const thumbnailSource =
    resolveImageUrl(pickThumbnailUrl(video?.images)) ??
    getMuxThumbnailUrl(streamingUrl)

  // Inline autoplay: muted, looping background video.
  // NOTE: p.play() in the setup callback does not work reliably on tvOS.
  // Use a separate useEffect, matching the pattern in VideoPlayer.tsx.
  const player = useVideoPlayer(hasValidStream ? streamingUrl! : null, (p) => {
    p.muted = true
    p.loop = true
  })

  // Auto-play on mount (separate effect — required for tvOS)
  useEffect(() => {
    if (hasValidStream) {
      player.play()
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
    <Pressable
      style={styles.container}
      onPress={() => {
        if (hasValidStream) {
          playVideo(
            streamingUrl!,
            heading ?? video?.title ?? undefined,
            subheading ?? undefined,
          )
        }
      }}
    >
      {/* Background layer: VideoView when stream is available, else thumbnail */}
      {hasValidStream ? (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          nativeControls={false}
          contentFit="cover"
        />
      ) : thumbnailSource != null ? (
        <Image
          source={thumbnailSource}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          recyclingKey={`video-hero-${section.kind}-${String(video?.documentId ?? "unknown")}`}
          accessibilityLabel={video?.title ?? heading ?? "Video hero image"}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallbackBg]} />
      )}

      {/* Smooth gradient fade into background — matches mobile-v2 */}
      <LinearGradient
        colors={[hexToRgba(COLORS.surface, 0), COLORS.surface]}
        locations={[0.4, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Text overlay */}
      <View style={styles.textContainer}>
        {heading != null && (
          <Text style={styles.title} numberOfLines={2}>
            {heading}
          </Text>
        )}
        {subheading != null && (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subheading}
          </Text>
        )}
      </View>
    </Pressable>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: HERO_HEIGHT,
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
    fontSize: 40,
    fontWeight: "bold",
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: "System",
    fontSize: 20,
    fontWeight: "400",
    color: COLORS.muted,
    marginTop: 8,
  },
})

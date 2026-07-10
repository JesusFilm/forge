import { useEffect } from "react"
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { useVideoPlayer, VideoView } from "expo-video"

import type { NormalizedBlock } from "../../lib/normalizer"
import { COLORS, hexToRgba } from "../../lib/colors"
import { scale } from "../../lib/scale"
import { resolveImageUrl, getMuxThumbnailUrl } from "../../lib/resolveImageUrl"
import { pickThumbnailUrl } from "../../lib/types"
import { useVideoPlayerContext } from "../../contexts/VideoPlayerContext"
import { validateStreamingUrl } from "../../lib/validateUrl"

// ── Constants ────────────────────────────────────────────────────────────────

const { height: SCREEN_HEIGHT } = Dimensions.get("window")
const HERO_HEIGHT = SCREEN_HEIGHT * 0.55

/** Used by the silent-focus Pressable below — see its inline comment. */
const noop = () => {}

// ── Types ────────────────────────────────────────────────────────────────────

export type VideoHeroRendererProps = {
  section: NormalizedBlock
}

// ── Component ────────────────────────────────────────────────────────────────

export function VideoHeroRenderer({ section }: VideoHeroRendererProps) {
  const { state: playerState } = useVideoPlayerContext()
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

  const hasValidStream =
    typeof streamingUrl === "string" && validateStreamingUrl(streamingUrl)
  const thumbnailSource =
    resolveImageUrl(pickThumbnailUrl(video?.images)) ??
    getMuxThumbnailUrl(streamingUrl)

  // Inline autoplay: muted, looping background video.
  // Source is guaranteed stable per mount — the section data does not change
  // after the initial render for a given experience detail screen.
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

  // Pause inline player when full-screen overlay opens, resume when dismissed
  useEffect(() => {
    if (!hasValidStream) return
    try {
      if (playerState.isVisible) {
        player.pause()
      } else {
        player.play()
      }
    } catch {
      // Native player already released
    }
  }, [player, playerState.isVisible, hasValidStream])

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
      {/* Background: VideoView when a stream exists, else thumbnail. All layers
          use pointerEvents="none" so the TV focus engine traverses past the
          native video surface to the silent-focus Pressable below. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {hasValidStream ? (
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            nativeControls={false}
            contentFit="cover"
            focusable={false}
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

        {/* Smooth gradient fade into background — matches mobile */}
        <LinearGradient
          colors={[hexToRgba(COLORS.surface, 0), COLORS.surface]}
          locations={[0.4, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      {/* Silent-focus target: full-bleed invisible Pressable catching D-pad UP so the
          ScrollView scrolls the hero into view. Intentional deviation from CLAUDE.md's
          "visible focus ring" rule. `onPress` no-op (not undefined) so Select doesn't flash; `android_ripple={null}` kills Android TV ripple. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        accessibilityLabel={heading ?? "Video hero"}
        onPress={noop}
        android_ripple={null}
      />

      {/* Text overlay */}
      <View style={styles.textContainer} pointerEvents="none">
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
    </View>
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
    bottom: scale(48),
    left: scale(80),
    right: scale(80),
  },
  title: {
    fontFamily: "System",
    fontSize: scale(40),
    fontWeight: "bold",
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: "System",
    fontSize: scale(20),
    fontWeight: "400",
    color: COLORS.muted,
    marginTop: scale(8),
  },
})

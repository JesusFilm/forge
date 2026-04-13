import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"

import type { NormalizedBlock } from "../../lib/normalizer"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
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
        }[]
      }
    | null
    | undefined

  const videoStill = video?.images?.[0]?.videoStill ?? null
  const ogImage = video?.images?.[0]?.url ?? null
  const imageSource = resolveImageUrl(videoStill) ?? resolveImageUrl(ogImage)

  return (
    <Pressable
      style={styles.container}
      onPress={() => {
        if (validateStreamingUrl(streamingUrl)) {
          playVideo(
            streamingUrl!,
            heading ?? video?.title ?? undefined,
            subheading ?? undefined,
          )
        } else {
          console.log(
            "[VideoHeroRenderer] No streamingUrl for:",
            heading ?? video?.slug,
          )
        }
      }}
    >
      {imageSource != null ? (
        <Image
          source={imageSource}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          recyclingKey={`video-hero-${section.kind}-${String(video?.documentId ?? "unknown")}`}
          accessibilityLabel={video?.title ?? heading ?? "Video hero image"}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallbackBg]} />
      )}

      {/* Gradient overlay: only show over images, not fallback */}
      {imageSource != null && (
        <>
          <View style={styles.gradientTop} />
          <View style={styles.gradientBottom} />
        </>
      )}

      {/* Text overlay — always visible, positioned above gradients */}
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

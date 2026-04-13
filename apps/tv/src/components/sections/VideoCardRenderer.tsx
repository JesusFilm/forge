import { StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"

import type { NormalizedBlock } from "../../lib/normalizer"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { pickThumbnailUrl } from "../../lib/types"
import { FocusableCard } from "../FocusableCard"
import { useVideoPlayerContext } from "../../contexts/VideoPlayerContext"
import { validateStreamingUrl } from "../../lib/validateUrl"

// ── Constants ────────────────────────────────────────────────────────────────

const CARD_WIDTH = 320
const THUMBNAIL_HEIGHT = 180

const COLORS = {
  surfaceContainerHigh: "#2D2927",
  text: "#F5F5F4",
  muted: "#A8A29E",
  surfaceContainerHighest: "#383432",
} as const

// ── Types ────────────────────────────────────────────────────────────────────

export interface VideoCardRendererProps {
  section: NormalizedBlock
}

// ── Component ────────────────────────────────────────────────────────────────

export function VideoCardRenderer({ section }: VideoCardRendererProps) {
  const { playVideo } = useVideoPlayerContext()
  const streamingUrl = section.streamingUrl as string | null | undefined

  const video = section.videoRef as
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

  const imageSource = resolveImageUrl(pickThumbnailUrl(video?.images))

  // Title: prefer video title, fall back to section heading
  const title = video?.title ?? (section.videoTitle as string | null) ?? null

  return (
    <FocusableCard
      onPress={() => {
        if (validateStreamingUrl(streamingUrl)) {
          playVideo(streamingUrl!, title ?? undefined)
        } else {
          console.log(
            "[VideoCardRenderer] No streamingUrl for:",
            title ?? video?.slug,
          )
        }
      }}
      style={styles.card}
    >
      <View style={styles.thumbnailContainer}>
        {imageSource != null ? (
          <Image
            source={imageSource}
            style={styles.thumbnail}
            contentFit="cover"
            recyclingKey={`video-card-${section.kind}-${String(video?.documentId ?? "unknown")}`}
            accessibilityLabel={title ?? "Video thumbnail"}
          />
        ) : (
          <View style={[styles.thumbnail, styles.thumbnailFallback]} />
        )}
      </View>
      {title != null && (
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
      )}
    </FocusableCard>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    backgroundColor: COLORS.surfaceContainerHigh,
    borderRadius: 16,
    overflow: "hidden",
  },
  thumbnailContainer: {
    width: CARD_WIDTH,
    height: THUMBNAIL_HEIGHT,
    position: "relative",
  },
  thumbnail: {
    width: CARD_WIDTH,
    height: THUMBNAIL_HEIGHT,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  thumbnailFallback: {
    backgroundColor: COLORS.surfaceContainerHighest,
  },
  title: {
    fontFamily: "System",
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.text,
    padding: 12,
  },
})

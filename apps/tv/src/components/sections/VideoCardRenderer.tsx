import { useEffect, useRef, useState } from "react"
import { StyleSheet, Text, View, useWindowDimensions } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"

import type { NormalizedBlock } from "../../lib/normalizer"
import { COLORS, hexToRgba } from "../../lib/colors"
import { resolveImageUrl, getMuxThumbnailUrl } from "../../lib/resolveImageUrl"
import { pickThumbnailUrl } from "../../lib/types"
import { FocusableCard } from "../FocusableCard"
import { useVideoPlayerContext } from "../../contexts/VideoPlayerContext"
import { validateStreamingUrl } from "../../lib/validateUrl"

// ── Constants ────────────────────────────────────────────────────────────────

const TARGET_WIDTH_RATIO = 0.65
const ASPECT_RATIO = 16 / 9
const PLAY_ICON_RATIO = 0.07
const FOCUS_SCALE = 1.05

// ── Types ────────────────────────────────────────────────────────────────────

export type VideoCardRendererProps = {
  section: NormalizedBlock
}

// ── Component ────────────────────────────────────────────────────────────────

export function VideoCardRenderer({ section }: VideoCardRendererProps) {
  const { playVideo, state: playerState } = useVideoPlayerContext()
  const { width: screenWidth } = useWindowDimensions()
  const [parentWidth, setParentWidth] = useState(0)
  const didStartPlaybackRef = useRef(false)
  const prevVisibleRef = useRef(playerState.isVisible)
  const [shouldRestoreFocus, setShouldRestoreFocus] = useState(false)

  const video = section.videoRef as
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

  // Resolve playback URL: prefer Mux streaming URL, fall back to uploaded media
  const sectionStreamingUrl = section.streamingUrl as string | null | undefined
  const mediaUrl = (section.media as { url?: string } | null | undefined)?.url
  const resolvedMediaUrl = mediaUrl ? resolveImageUrl(mediaUrl) : null

  const playbackUrl =
    typeof sectionStreamingUrl === "string" &&
    validateStreamingUrl(sectionStreamingUrl)
      ? sectionStreamingUrl
      : typeof resolvedMediaUrl === "string" &&
          validateStreamingUrl(resolvedMediaUrl)
        ? resolvedMediaUrl
        : null

  const imageSource =
    resolveImageUrl(pickThumbnailUrl(video?.images)) ??
    getMuxThumbnailUrl(sectionStreamingUrl)

  const title = video?.title ?? (section.videoTitle as string | null) ?? null

  // ── Sizing: 65% of screen width, capped to parent container ──
  const targetWidth = Math.round(screenWidth * TARGET_WIDTH_RATIO)
  const cardWidth =
    parentWidth > 0 ? Math.min(targetWidth, parentWidth) : targetWidth
  const cardHeight = Math.round(cardWidth / ASPECT_RATIO)
  const playIconSize = Math.round(cardWidth * PLAY_ICON_RATIO)
  const playGlyphSize = Math.round(playIconSize * 0.45)

  // ── Focus restore: only the card that started playback gets focus back ──
  useEffect(() => {
    if (prevVisibleRef.current && !playerState.isVisible) {
      if (didStartPlaybackRef.current) {
        setShouldRestoreFocus(true)
        didStartPlaybackRef.current = false
      }
    }
    prevVisibleRef.current = playerState.isVisible
  }, [playerState.isVisible])

  useEffect(() => {
    if (shouldRestoreFocus) {
      const timer = setTimeout(() => setShouldRestoreFocus(false), 100)
      return () => clearTimeout(timer)
    }
  }, [shouldRestoreFocus])

  return (
    <View onLayout={(e) => setParentWidth(e.nativeEvent.layout.width)}>
      <FocusableCard
        onPress={() => {
          if (playbackUrl != null) {
            didStartPlaybackRef.current = true
            playVideo(playbackUrl, title ?? undefined)
          }
        }}
        focusScale={FOCUS_SCALE}
        hasTVPreferredFocus={shouldRestoreFocus}
        accessibilityLabel={title ? `Play ${title}` : "Play video"}
        style={{
          width: cardWidth,
          height: cardHeight,
          alignSelf: "center",
          backgroundColor: COLORS.surfaceContainerHigh,
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
        {/* Thumbnail */}
        {imageSource != null ? (
          <Image
            source={imageSource}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            recyclingKey={`video-card-${section.kind}-${String(video?.documentId ?? "unknown")}`}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.thumbnailFallback]} />
        )}

        {/* Gradient overlay (decorative, not focusable) */}
        <LinearGradient
          colors={[
            hexToRgba(COLORS.surfaceContainerHigh, 0),
            COLORS.surfaceContainerHigh,
          ]}
          locations={[0.4, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        {/* Play icon (decorative overlay, not focusable) */}
        <View style={styles.playIconContainer} pointerEvents="none">
          <View
            style={[
              styles.playIcon,
              {
                width: playIconSize,
                height: playIconSize,
                borderRadius: playIconSize / 2,
              },
            ]}
          >
            <Text
              style={[
                styles.playGlyph,
                {
                  fontSize: playGlyphSize,
                  marginLeft: Math.round(playGlyphSize * 0.15),
                },
              ]}
            >
              {"\u25B6"}
            </Text>
          </View>
        </View>

        {/* Title in gradient area (decorative overlay, not focusable) */}
        {title != null && (
          <View style={styles.titleContainer} pointerEvents="none">
            <Text style={styles.title} numberOfLines={2}>
              {title}
            </Text>
          </View>
        )}
      </FocusableCard>
    </View>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  thumbnailFallback: {
    backgroundColor: COLORS.surfaceContainerHighest,
  },
  playIconContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  playIcon: {
    backgroundColor: hexToRgba("#000000", 0.5),
    justifyContent: "center",
    alignItems: "center",
  },
  playGlyph: {
    color: COLORS.text,
    fontFamily: "System",
  },
  titleContainer: {
    position: "absolute",
    bottom: 16,
    left: 24,
    right: 24,
  },
  title: {
    fontFamily: "System",
    fontSize: 24,
    fontWeight: "600",
    color: COLORS.text,
  },
})

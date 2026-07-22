import { useEffect, useRef, useState } from "react"
import { StyleSheet, Text, View, useWindowDimensions } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"

import type { VideoBlockModel } from "../../lib/normalizer"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import { scale } from "../../lib/scale"
import {
  extractMuxPlaybackId,
  EXPERIENCE_CARD_PREVIEW_OPTS,
} from "../../lib/muxUrl"
import { getMuxThumbnailUrl } from "../../lib/resolveImageUrl"
import { FocusableCard } from "../FocusableCard"
import { useHoverPreview } from "../focus/useHoverPreview"
import { HoverPreviewImage } from "../watch/HoverPreviewImage"
import { useVideoPlayerContext } from "../../contexts/VideoPlayerContext"
import { validateStreamingUrl } from "../../lib/validateUrl"
import { blockMuxPlaybackId, blockStreamingUrl } from "../../lib/blockVideoDub"

// ── Constants ────────────────────────────────────────────────────────────────

const TARGET_WIDTH_RATIO = 0.65
const ASPECT_RATIO = 16 / 9
const PLAY_ICON_RATIO = 0.07
const FOCUS_SCALE = 1.05

// ── Types ────────────────────────────────────────────────────────────────────

export type VideoCardRendererProps = {
  section: VideoBlockModel
}

// ── Component ────────────────────────────────────────────────────────────────

export function VideoCardRenderer({ section }: VideoCardRendererProps) {
  const { playVideo, state: playerState } = useVideoPlayerContext()
  const { width: screenWidth } = useWindowDimensions()
  const [parentWidth, setParentWidth] = useState(0)
  const didStartPlaybackRef = useRef(false)
  const prevVisibleRef = useRef(playerState.isVisible)
  const [shouldRestoreFocus, setShouldRestoreFocus] = useState(false)

  // Playback URL: only Mux streaming URLs are allowed (validateStreamingUrl
  // enforces stream.mux.com). CMS-uploaded media URLs use different hosts
  // and cannot pass validation, so no fallback is attempted.
  const sectionStreamingUrl = blockStreamingUrl(section)
  const playbackUrl =
    typeof sectionStreamingUrl === "string" &&
    validateStreamingUrl(sectionStreamingUrl)
      ? sectionStreamingUrl
      : null

  // The fragment fetches no video record — the poster is always Mux-derived.
  const imageSource = getMuxThumbnailUrl(sectionStreamingUrl)

  const title = section.videoTitle ?? null

  const [focused, setFocused] = useState(false)
  const previewUrl = useHoverPreview({
    focused,
    enabled: true,
    playbackId:
      blockMuxPlaybackId(section) ?? extractMuxPlaybackId(sectionStreamingUrl),
    // This inline card is far larger than a rail thumb — request Mux's max-quality
    // animated preview (accepts a cold ~5s transcode); rails keep the warm default.
    previewOpts: EXPERIENCE_CARD_PREVIEW_OPTS,
  })

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
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        focusScale={FOCUS_SCALE}
        hasTVPreferredFocus={shouldRestoreFocus}
        accessibilityLabel={title ? `Play ${title}` : "Play video"}
        style={{
          width: cardWidth,
          height: cardHeight,
          alignSelf: "center",
          backgroundColor: WATCH_THEME.scrim(1),
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
            recyclingKey={`video-card-${section.videoId ?? "unknown"}`}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.thumbnailFallback]} />
        )}

        {/* Gradient overlay (decorative, not focusable) */}
        <LinearGradient
          colors={[WATCH_THEME.scrim(0), WATCH_THEME.scrim(1)]}
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

        {/* Above the thumbnail + play icon, below the title (KTD6 z-order). */}
        <HoverPreviewImage previewUrl={previewUrl} contentFit="cover" />

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
    backgroundColor: WATCH_THEME.below,
  },
  playIconContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  playIcon: {
    backgroundColor: WATCH_THEME.scrim(0.5),
    justifyContent: "center",
    alignItems: "center",
  },
  playGlyph: {
    color: WATCH_THEME.text,
    fontFamily: "System",
  },
  titleContainer: {
    position: "absolute",
    bottom: scale(16),
    left: scale(24),
    right: scale(24),
  },
  title: {
    fontFamily: "System",
    fontSize: scale(24),
    fontWeight: "600",
    color: WATCH_THEME.text,
  },
})

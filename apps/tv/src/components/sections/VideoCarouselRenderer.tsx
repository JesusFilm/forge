import React, { useCallback, useState } from "react"
import { FlatList, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"

import type { VideoCarouselBlockModel } from "../../lib/normalizer"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import { SECTION_HEADING } from "./sectionHeading"
import { scale } from "../../lib/scale"
import { extractMuxPlaybackId } from "../../lib/muxUrl"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { validateStreamingUrl } from "../../lib/validateUrl"
import { FocusableCard } from "../FocusableCard"
import { useHoverPreview } from "../focus/useHoverPreview"
import { HoverPreviewImage } from "../watch/HoverPreviewImage"
import { useVideoPlayerContext } from "../../contexts/VideoPlayerContext"
import { blockMuxPlaybackId, blockStreamingUrl } from "../../lib/blockVideoDub"

// ── Constants ────────────────────────────────────────────────────────────────

const CARD_WIDTH = scale(320)
const CARD_HEIGHT = scale(150) // 32:15 (2.13:1) of the 320 width — cinematic art
const CARD_GAP = scale(24)

// ── Types ────────────────────────────────────────────────────────────────────

// Derived from the fragment: resolved dub + overrides only (no nested video
// record is fetched on TV).
type VideoCarouselItem = NonNullable<VideoCarouselBlockModel["items"]>[number]

// ── VideoCarouselCard ────────────────────────────────────────────────────────

function VideoCarouselCard({
  item,
  onPress,
}: {
  item: VideoCarouselItem
  onPress: () => void
}) {
  const thumbnailUrl = resolveImageUrl(item.imageUrl ?? null)
  const title = item.titleOverride ?? "Untitled"
  const [focused, setFocused] = useState(false)
  const previewUrl = useHoverPreview({
    focused,
    enabled: true,
    playbackId:
      blockMuxPlaybackId(item) ?? extractMuxPlaybackId(blockStreamingUrl(item)),
  })

  return (
    <FocusableCard
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={styles.card}
    >
      <View style={styles.thumbnailContainer}>
        {thumbnailUrl != null ? (
          <Image
            source={thumbnailUrl}
            style={styles.thumbnail}
            contentFit="cover"
            contentPosition="top left"
            recyclingKey={`vc-${item.videoId ?? "item"}`}
            accessibilityLabel={title}
          />
        ) : (
          <View
            style={[
              styles.thumbnail,
              {
                backgroundColor:
                  item.backgroundColor ?? WATCH_THEME.cardFallback,
              },
            ]}
          />
        )}

        {/* Play icon */}
        <View style={styles.playIconContainer}>
          <View style={styles.playIcon}>
            <Text style={styles.playGlyph}>{"\u25B6"}</Text>
          </View>
        </View>

        {/* Above the thumbnail + play icon, below the title band (KTD6 z-order). */}
        <HoverPreviewImage previewUrl={previewUrl} contentFit="cover" />

        {/* Title band */}
        <View style={styles.titleBand}>
          <Text style={styles.titleText} numberOfLines={1}>
            {title}
          </Text>
        </View>
      </View>
    </FocusableCard>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export function VideoCarouselRenderer({
  section,
}: {
  section: VideoCarouselBlockModel
}) {
  const { playVideo } = useVideoPlayerContext()

  const heading = section.vcTitle
  const subtitle = section.vcSubtitle
  const items: VideoCarouselItem[] = section.items ?? []

  const handlePress = useCallback(
    (item: VideoCarouselItem) => {
      const streamingUrl = blockStreamingUrl(item)
      if (
        typeof streamingUrl === "string" &&
        validateStreamingUrl(streamingUrl)
      ) {
        playVideo(streamingUrl, item.titleOverride ?? undefined)
      }
    },
    [playVideo],
  )

  const renderItem = useCallback(
    ({ item }: { item: VideoCarouselItem }) => (
      <View style={styles.cardWrapper}>
        <VideoCarouselCard item={item} onPress={() => handlePress(item)} />
      </View>
    ),
    [handlePress],
  )

  const keyExtractor = useCallback(
    (item: VideoCarouselItem, index: number) =>
      `vc-${item.videoId ?? "item"}-${index}`,
    [],
  )

  if (items.length === 0) return null

  return (
    <View style={styles.container}>
      {subtitle != null && <Text style={styles.subtitle}>{subtitle}</Text>}
      {heading != null && (
        <Text style={styles.heading} accessibilityRole="header">
          {heading}
        </Text>
      )}
      <TVFocusGuideView autoFocus>
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={Separator}
        />
      </TVFocusGuideView>
    </View>
  )
}

function Separator() {
  return <View style={styles.separator} />
}

// ── Styles ───────────────────────────────────────────────────────────────────

const PLAY_ICON_SIZE = scale(48)
const SUBTITLE_FONT_SIZE = scale(18)
const TITLE_FONT_SIZE = scale(18)
const PLAY_GLYPH_SIZE = scale(20)

const styles = StyleSheet.create({
  container: {
    marginBottom: scale(32),
  },
  subtitle: {
    fontFamily: "System",
    fontSize: SUBTITLE_FONT_SIZE,
    fontWeight: "400",
    color: WATCH_THEME.text74,
    marginBottom: scale(4),
    paddingHorizontal: scale(80),
  },
  heading: {
    ...SECTION_HEADING,
    marginBottom: scale(12),
    paddingHorizontal: scale(80),
  },
  listContent: {
    paddingHorizontal: scale(80),
  },
  cardWrapper: {
    paddingVertical: scale(40),
  },
  separator: {
    width: CARD_GAP,
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: WATCH_THEME.scrim(1),
    borderRadius: scale(16),
    overflow: "hidden",
  },
  thumbnailContainer: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    position: "relative",
  },
  thumbnail: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  },
  playIconContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  playIcon: {
    width: PLAY_ICON_SIZE,
    height: PLAY_ICON_SIZE,
    borderRadius: PLAY_ICON_SIZE / 2,
    backgroundColor: WATCH_THEME.scrim(0.5),
    justifyContent: "center",
    alignItems: "center",
  },
  playGlyph: {
    fontFamily: "System",
    fontSize: PLAY_GLYPH_SIZE,
    color: WATCH_THEME.text,
    // Slight offset to visually center the triangle glyph
    marginLeft: scale(3),
  },
  titleBand: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: WATCH_THEME.scrim(0.4),
    padding: scale(12),
  },
  titleText: {
    fontFamily: "System",
    fontSize: TITLE_FONT_SIZE,
    fontWeight: "700",
    color: WATCH_THEME.text,
  },
})

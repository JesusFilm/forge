import React, { useCallback } from "react"
import {
  FlatList,
  Platform,
  StyleSheet,
  Text,
  View,
  TVFocusGuideView,
} from "react-native"
import { Image } from "expo-image"

import type { NormalizedBlock } from "../../lib/normalizer"
import { COLORS, hexToRgba } from "../../lib/colors"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { pickThumbnailUrl } from "../../lib/types"
import { validateStreamingUrl } from "../../lib/validateUrl"
import { FocusableCard } from "../FocusableCard"
import { useVideoPlayerContext } from "../../contexts/VideoPlayerContext"

// ── Constants ────────────────────────────────────────────────────────────────

const CARD_WIDTH = 320
const CARD_HEIGHT = 180
const CARD_GAP = 24

// ── Types ────────────────────────────────────────────────────────────────────

type VideoCarouselItem = {
  id: string
  streamingUrl?: string | null
  imageUrl?: string | null
  titleOverride?: string | null
  backgroundColor?: string | null
  video?: {
    documentId?: string
    title?: string
    slug?: string
    streamingUrl?: string
    imageAlt?: string
    images?: {
      url?: string
      mobileCinematicHigh?: string
      videoStill?: string
    }[]
  } | null
}

// ── VideoCarouselCard ────────────────────────────────────────────────────────

function VideoCarouselCard({
  item,
  onPress,
}: {
  item: VideoCarouselItem
  onPress: () => void
}) {
  const thumbnailUrl = resolveImageUrl(
    item.imageUrl ?? pickThumbnailUrl(item.video?.images),
  )
  const title = item.titleOverride ?? item.video?.title ?? "Untitled"

  return (
    <FocusableCard onPress={onPress} style={styles.card}>
      <View style={styles.thumbnailContainer}>
        {thumbnailUrl != null ? (
          <Image
            source={thumbnailUrl}
            style={styles.thumbnail}
            contentFit="cover"
            recyclingKey={`vc-${item.id}`}
            accessibilityLabel={title}
          />
        ) : (
          <View
            style={[
              styles.thumbnail,
              {
                backgroundColor:
                  item.backgroundColor ?? COLORS.surfaceContainer,
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
  section: NormalizedBlock
}) {
  const { playVideo } = useVideoPlayerContext()

  const heading = section.vcTitle as string | null | undefined
  const subtitle = section.vcSubtitle as string | null | undefined
  const items = (section.items as VideoCarouselItem[] | undefined) ?? []

  const handlePress = useCallback(
    (item: VideoCarouselItem) => {
      const streamingUrl = item.streamingUrl ?? item.video?.streamingUrl ?? null
      if (
        typeof streamingUrl === "string" &&
        validateStreamingUrl(streamingUrl)
      ) {
        const title = item.titleOverride ?? item.video?.title ?? undefined
        playVideo(streamingUrl, title)
      }
    },
    [playVideo],
  )

  const renderItem = useCallback(
    ({ item }: { item: VideoCarouselItem }) => (
      <VideoCarouselCard item={item} onPress={() => handlePress(item)} />
    ),
    [handlePress],
  )

  const keyExtractor = useCallback(
    (item: VideoCarouselItem, index: number) => `vc-${item.id}-${index}`,
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

const PLAY_ICON_SIZE = 48
const SUBTITLE_FONT_SIZE = 18
const HEADING_FONT_SIZE = 24
const TITLE_FONT_SIZE = 18
const PLAY_GLYPH_SIZE = 20

const styles = StyleSheet.create({
  container: {
    marginBottom: 32,
  },
  subtitle: {
    fontFamily: "System",
    fontSize:
      Platform.OS === "android"
        ? Math.round(SUBTITLE_FONT_SIZE)
        : SUBTITLE_FONT_SIZE,
    fontWeight: "400",
    color: COLORS.muted,
    marginBottom: 4,
    paddingHorizontal: 80,
  },
  heading: {
    fontFamily: "System",
    fontSize:
      Platform.OS === "android"
        ? Math.round(HEADING_FONT_SIZE)
        : HEADING_FONT_SIZE,
    fontWeight: "600",
    color: COLORS.text,
    marginBottom: 12,
    paddingHorizontal: 80,
  },
  listContent: {
    paddingHorizontal: 80,
  },
  separator: {
    width: CARD_GAP,
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 16,
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
    backgroundColor: hexToRgba("#000000", 0.5),
    justifyContent: "center",
    alignItems: "center",
  },
  playGlyph: {
    fontFamily: "System",
    fontSize:
      Platform.OS === "android" ? Math.round(PLAY_GLYPH_SIZE) : PLAY_GLYPH_SIZE,
    color: COLORS.text,
    // Slight offset to visually center the triangle glyph
    marginLeft: 3,
  },
  titleBand: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: hexToRgba("#000000", 0.4),
    padding: 12,
  },
  titleText: {
    fontFamily: "System",
    fontSize:
      Platform.OS === "android" ? Math.round(TITLE_FONT_SIZE) : TITLE_FONT_SIZE,
    fontWeight: "700",
    color: COLORS.text,
  },
})

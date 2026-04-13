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
import { LinearGradient } from "expo-linear-gradient"
import { useRouter } from "expo-router"

import type { NormalizedBlock } from "../../lib/normalizer"
import { COLORS, hexToRgba } from "../../lib/colors"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { pickThumbnailUrl } from "../../lib/types"
import { validateStreamingUrl } from "../../lib/validateUrl"
import { FocusableCard } from "../FocusableCard"
import { useVideoPlayerContext } from "../../contexts/VideoPlayerContext"

// ── Types ────────────────────────────────────────────────────────────────────

type MediaItem = {
  id: string
  titleOverride?: string | null
  subtitleOverride?: string | null
  labelOverride?: string | null
  collectionSize?: number | null
  imageUrl?: string | null
  linkToSectionKey?: string | null
  video?: {
    slug?: string
    title?: string
    streamingUrl?: string
    imageAlt?: string
    images?: {
      url?: string
      mobileCinematicHigh?: string
      videoStill?: string
    }[]
  } | null
}

// ── Constants ────────────────────────────────────────────────────────────────

const CARD_WIDTH = 260
const CARD_HEIGHT = 347
const CARD_GAP = 24

const GRADIENT_COLORS: [string, string] = [
  hexToRgba("#000000", 0),
  hexToRgba("#000000", 0.85),
]

// ── Component ────────────────────────────────────────────────────────────────

export function MediaCollectionRenderer({
  section,
}: {
  section: NormalizedBlock
}) {
  const router = useRouter()
  const { playVideo } = useVideoPlayerContext()

  const mcTitle = section.mcTitle as string | null
  const mcSubtitle = section.mcSubtitle as string | null
  const categoryLabel = section.categoryLabel as string | null
  const items = (section.items as MediaItem[] | undefined) ?? []

  const renderItem = useCallback(
    ({ item, index }: { item: MediaItem; index: number }) => {
      const thumbnailUrl = resolveImageUrl(
        item.imageUrl ?? pickThumbnailUrl(item.video?.images),
      )
      const title = item.titleOverride ?? item.video?.title ?? "Untitled"
      const label = item.labelOverride ?? categoryLabel

      const handlePress = () => {
        const streamingUrl = item.video?.streamingUrl ?? null
        if (
          typeof streamingUrl === "string" &&
          validateStreamingUrl(streamingUrl)
        ) {
          playVideo(streamingUrl, title)
          return
        }
        if (item.video?.slug) {
          router.push(`/experience/${encodeURIComponent(item.video.slug)}`)
          return
        }
        // no-op
      }

      return (
        <FocusableCard onPress={handlePress} style={styles.card}>
          <View style={styles.cardInner}>
            {thumbnailUrl != null ? (
              <Image
                source={thumbnailUrl}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                recyclingKey={`mc-${item.id}-${index}`}
                accessibilityLabel={item.video?.imageAlt ?? title}
              />
            ) : (
              <View
                style={[StyleSheet.absoluteFill, styles.thumbnailFallback]}
              />
            )}
            <LinearGradient
              colors={GRADIENT_COLORS}
              locations={[0.4, 1]}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            {item.collectionSize != null && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{item.collectionSize}</Text>
              </View>
            )}
            <View style={styles.textContent}>
              {label != null && (
                <Text style={styles.label} numberOfLines={1}>
                  {label.toUpperCase()}
                </Text>
              )}
              <Text style={styles.cardTitle} numberOfLines={2}>
                {title}
              </Text>
            </View>
          </View>
        </FocusableCard>
      )
    },
    [categoryLabel, playVideo, router],
  )

  const keyExtractor = useCallback(
    (item: MediaItem, index: number) => `mc-${item.id}-${index}`,
    [],
  )

  if (items.length === 0) return null

  return (
    <View style={styles.container}>
      {categoryLabel != null && (
        <Text style={styles.categoryCaption}>
          {categoryLabel.toUpperCase()}
        </Text>
      )}
      {mcTitle != null && (
        <Text style={styles.heading} accessibilityRole="header">
          {mcTitle}
        </Text>
      )}
      {mcSubtitle != null && <Text style={styles.subtitle}>{mcSubtitle}</Text>}
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

const fontSize14 = Platform.OS === "android" ? Math.round(14) : 14
const fontSize16 = Platform.OS === "android" ? Math.round(16) : 16
const fontSize18 = Platform.OS === "android" ? Math.round(18) : 18
const fontSize24 = Platform.OS === "android" ? Math.round(24) : 24

const styles = StyleSheet.create({
  container: {
    marginBottom: 32,
  },
  categoryCaption: {
    fontFamily: "System",
    fontSize: fontSize16,
    fontWeight: "600",
    color: COLORS.muted,
    letterSpacing: 1,
    textTransform: "uppercase",
    paddingHorizontal: 80,
    marginBottom: 4,
  },
  heading: {
    fontFamily: "System",
    fontSize: fontSize24,
    fontWeight: "700",
    color: COLORS.text,
    paddingHorizontal: 80,
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: "System",
    fontSize: fontSize18,
    fontWeight: "400",
    color: COLORS.muted,
    paddingHorizontal: 80,
    marginBottom: 12,
  },
  listContent: {
    paddingHorizontal: 80,
  },
  separator: {
    width: CARD_GAP,
  },
  card: {
    width: CARD_WIDTH,
    borderRadius: 16,
    overflow: "hidden",
  },
  cardInner: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    position: "relative",
  },
  thumbnailFallback: {
    backgroundColor: COLORS.surfaceContainerHighest,
  },
  badge: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: {
    fontFamily: "System",
    fontSize: fontSize14,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  textContent: {
    position: "absolute",
    bottom: 12,
    left: 12,
    right: 12,
  },
  label: {
    fontFamily: "System",
    fontSize: fontSize14,
    fontWeight: "700",
    color: "rgba(255,255,255,0.9)",
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  cardTitle: {
    fontFamily: "System",
    fontSize: fontSize18,
    fontWeight: "700",
    color: "#FFFFFF",
  },
})

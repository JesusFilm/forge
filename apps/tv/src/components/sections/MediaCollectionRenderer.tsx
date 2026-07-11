import React, { useCallback } from "react"
import { FlatList, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { useRouter } from "expo-router"

import type { NormalizedBlock } from "../../lib/normalizer"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import { SECTION_HEADING } from "./sectionHeading"
import { scale } from "../../lib/scale"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { pickThumbnailUrl } from "../../lib/types"
import { validateStreamingUrl } from "../../lib/validateUrl"
import { FocusableCard } from "../FocusableCard"
import { useVideoPlayerContext } from "../../contexts/VideoPlayerContext"
import { useExperienceContext } from "../../contexts/ExperienceProvider"

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

const CARD_WIDTH = scale(260)
const CARD_HEIGHT = scale(347)
const CARD_GAP = scale(24)

const GRADIENT_COLORS: [string, string] = [
  WATCH_THEME.scrim(0),
  WATCH_THEME.scrim(0.85),
]

// ── Component ────────────────────────────────────────────────────────────────

export function MediaCollectionRenderer({
  section,
}: {
  section: NormalizedBlock
}) {
  const router = useRouter()
  const { playVideo } = useVideoPlayerContext()
  const { scrollToSection } = useExperienceContext()

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
        if (item.linkToSectionKey) {
          scrollToSection(item.linkToSectionKey)
          return
        }
        if (item.video?.slug) {
          router.push(`/experience/${encodeURIComponent(item.video.slug)}`)
          return
        }
      }

      return (
        <View style={styles.cardWrapper}>
          <FocusableCard onPress={handlePress} style={styles.card}>
            <View style={styles.cardInner}>
              {thumbnailUrl != null ? (
                <Image
                  source={thumbnailUrl}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  contentPosition="top left"
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
        </View>
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

const fontSize14 = scale(14)
const fontSize16 = scale(16)
const fontSize18 = scale(18)

const styles = StyleSheet.create({
  container: {
    marginBottom: scale(32),
  },
  categoryCaption: {
    fontFamily: "System",
    fontSize: fontSize16,
    fontWeight: "600",
    color: WATCH_THEME.accent,
    letterSpacing: 1,
    textTransform: "uppercase",
    paddingHorizontal: scale(80),
    marginBottom: scale(4),
  },
  heading: {
    ...SECTION_HEADING,
    paddingHorizontal: scale(80),
    marginBottom: scale(4),
  },
  subtitle: {
    fontFamily: "System",
    fontSize: fontSize18,
    fontWeight: "400",
    color: WATCH_THEME.text74,
    paddingHorizontal: scale(80),
    marginBottom: scale(12),
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
    backgroundColor: WATCH_THEME.scrim(1),
    borderRadius: scale(16),
    overflow: "hidden",
  },
  cardInner: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    position: "relative",
  },
  thumbnailFallback: {
    backgroundColor: WATCH_THEME.cardFallback,
  },
  badge: {
    position: "absolute",
    top: scale(8),
    right: scale(8),
    backgroundColor: WATCH_THEME.scrim(0.6),
    borderRadius: scale(6),
    paddingHorizontal: scale(8),
    paddingVertical: scale(4),
  },
  badgeText: {
    fontFamily: "System",
    fontSize: fontSize14,
    fontWeight: "700",
    color: WATCH_THEME.text,
  },
  textContent: {
    position: "absolute",
    bottom: scale(12),
    left: scale(12),
    right: scale(12),
  },
  label: {
    fontFamily: "System",
    fontSize: fontSize14,
    fontWeight: "700",
    color: WATCH_THEME.text82,
    letterSpacing: 0.8,
    marginBottom: scale(2),
  },
  cardTitle: {
    fontFamily: "System",
    fontSize: fontSize18,
    fontWeight: "700",
    color: WATCH_THEME.text,
  },
})

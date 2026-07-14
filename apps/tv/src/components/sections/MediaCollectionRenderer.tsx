import React, { useCallback } from "react"
import { FlatList, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"

import type { MediaCollectionBlockModel } from "../../lib/normalizer"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import { SECTION_HEADING } from "./sectionHeading"
import { scale } from "../../lib/scale"
import {
  resolveMediaItemImageUrl,
  resolveMediaItemTitle,
} from "../../lib/experienceHydration"
import { FocusableCard } from "../FocusableCard"
import { useExperienceContext } from "../../contexts/ExperienceProvider"

// ── Types ────────────────────────────────────────────────────────────────────

// Derived from the fragment: an item carries overrides + videoId only (no
// nested video record is fetched on TV).
type MediaItem = NonNullable<MediaCollectionBlockModel["items"]>[number]

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
  section: MediaCollectionBlockModel
}) {
  const { scrollToSection, videoByCoreId } = useExperienceContext()

  const { mcTitle, mcSubtitle, categoryLabel } = section
  const items: MediaItem[] = section.items ?? []

  const renderItem = useCallback(
    ({ item, index }: { item: MediaItem; index: number }) => {
      // Authored overrides are usually null on these cards; resolve title + image
      // from the coreId-hydrated video (the Home rail's data), else fall back.
      const video = item.coreId ? videoByCoreId.get(item.coreId) : undefined
      const thumbnailUrl = resolveMediaItemImageUrl(item, video)
      const title = resolveMediaItemTitle(item, video)
      const label = item.labelOverride ?? categoryLabel

      // The fragment fetches no video record, so a card's only live action
      // is the in-page section jump.
      const handlePress = () => {
        if (item.linkToSectionKey) {
          scrollToSection(item.linkToSectionKey)
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
                  recyclingKey={`mc-${item.videoId ?? "item"}-${index}`}
                  accessibilityLabel={title}
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
    [categoryLabel, scrollToSection, videoByCoreId],
  )

  const keyExtractor = useCallback(
    (item: MediaItem, index: number) => `mc-${item.videoId ?? "item"}-${index}`,
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

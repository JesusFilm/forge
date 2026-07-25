import React, { useCallback } from "react"
import { FlatList, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"

import type { NavigationCarouselBlockModel } from "../../lib/normalizer"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import { SECTION_HEADING } from "./sectionHeading"
import { scale } from "../../lib/scale"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { blockImageAssetPreviewUrl } from "../../lib/blockImageAsset"
import { FocusableCard } from "../FocusableCard"
import { useExperienceContext } from "../../contexts/ExperienceProvider"

// ── Constants ────────────────────────────────────────────────────────────────

const CARD_WIDTH = scale(260)
const CARD_HEIGHT = scale(300)
const CARD_GAP = scale(24)

// ── Types ────────────────────────────────────────────────────────────────────

// Derived from the fragment (no id is fetched; contentId is the identity).
type NavItem = NonNullable<NavigationCarouselBlockModel["items"]>[number]

export interface NavigationCarouselRendererProps {
  section: NavigationCarouselBlockModel
}

// ── NavCard ─────────────────────────────────────────────────────────────────

function NavCard({ item }: { item: NavItem }) {
  const { scrollToSection } = useExperienceContext()
  const imageSource = resolveImageUrl(
    blockImageAssetPreviewUrl(item.imageAsset),
  )
  const bgColor = item.backgroundColor ?? WATCH_THEME.scrim(1)

  return (
    <FocusableCard
      onPress={() => item.contentId && scrollToSection(item.contentId)}
      style={{ ...styles.card, backgroundColor: bgColor }}
    >
      {imageSource != null && (
        <Image
          source={imageSource}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          contentPosition="top left"
          recyclingKey={`nav-${item.contentId ?? "item"}`}
        />
      )}
      <LinearGradient
        colors={[WATCH_THEME.scrim(0), WATCH_THEME.scrim(0.7)]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={styles.cardContent}>
        {item.category != null && (
          <Text style={styles.category} numberOfLines={1}>
            {item.category.toUpperCase()}
          </Text>
        )}
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>
      </View>
    </FocusableCard>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export function NavigationCarouselRenderer({
  section,
}: {
  section: NavigationCarouselBlockModel
}) {
  // The fragment fetches no heading — this rail is always titled "Stories".
  const heading = "Stories"
  const items: NavItem[] = section.items ?? []

  const renderItem = useCallback(
    ({ item }: { item: NavItem }) => (
      <View style={styles.cardWrapper}>
        <NavCard item={item} />
      </View>
    ),
    [],
  )

  const keyExtractor = useCallback(
    (item: NavItem, index: number) =>
      `navCarousel-${item.contentId ?? "item"}-${index}`,
    [],
  )

  if (items.length === 0) return null

  return (
    <View style={styles.container}>
      <Text style={styles.heading} accessibilityRole="header">
        {heading}
      </Text>
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

const CATEGORY_FONT_SIZE = scale(14)

const TITLE_FONT_SIZE = scale(20)

const styles = StyleSheet.create({
  container: {
    marginBottom: scale(32),
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
    borderRadius: scale(16),
    overflow: "hidden",
  },
  cardContent: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    padding: scale(16),
  },
  category: {
    fontFamily: "System",
    fontSize: CATEGORY_FONT_SIZE,
    fontWeight: "700",
    color: WATCH_THEME.text82,
    letterSpacing: 1.2,
    marginBottom: scale(4),
  },
  title: {
    fontFamily: "System",
    fontSize: TITLE_FONT_SIZE,
    fontWeight: "700",
    color: WATCH_THEME.text,
    lineHeight: scale(26),
  },
})

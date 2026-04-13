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

import type { NormalizedBlock } from "../../lib/normalizer"
import { COLORS, hexToRgba } from "../../lib/colors"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { FocusableCard } from "../FocusableCard"

// ── Constants ────────────────────────────────────────────────────────────────

const CARD_WIDTH = 260
const CARD_HEIGHT = 300
const CARD_GAP = 24

// ── Types ────────────────────────────────────────────────────────────────────

type NavItem = {
  id: string
  contentId: string
  title: string
  category?: string | null
  imageUrl?: string | null
  backgroundColor?: string | null
}

export interface NavigationCarouselRendererProps {
  section: NormalizedBlock
}

// ── NavCard ─────────────────────────────────────────────────────────────────

function NavCard({ item }: { item: NavItem }) {
  const imageSource = resolveImageUrl(item.imageUrl ?? null)
  const bgColor = item.backgroundColor ?? "#292524"

  return (
    <FocusableCard
      onPress={() => {
        // TODO: scroll to section via contentId — in-experience scroll-to is
        // deferred to a future task (same as mobile-v2).
        console.log("[NavigationCarousel] Navigate to:", item.contentId)
      }}
      style={{ ...styles.card, backgroundColor: bgColor }}
    >
      {imageSource != null && (
        <Image
          source={imageSource}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          recyclingKey={`nav-${item.id}`}
        />
      )}
      <LinearGradient
        colors={[hexToRgba("#000000", 0), hexToRgba("#000000", 0.7)]}
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
  section: NormalizedBlock
}) {
  const heading = (section.navHeading as string | null) ?? "Stories"
  const items = (section.items as NavItem[] | undefined) ?? []

  const renderItem = useCallback(
    ({ item }: { item: NavItem }) => <NavCard item={item} />,
    [],
  )

  const keyExtractor = useCallback(
    (item: NavItem, index: number) => `navCarousel-${item.id}-${index}`,
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

const HEADING_FONT_SIZE = Platform.OS === "android" ? Math.round(24) : 24

const CATEGORY_FONT_SIZE = Platform.OS === "android" ? Math.round(14) : 14

const TITLE_FONT_SIZE = Platform.OS === "android" ? Math.round(20) : 20

const styles = StyleSheet.create({
  container: {
    marginBottom: 32,
  },
  heading: {
    fontFamily: "System",
    fontSize: HEADING_FONT_SIZE,
    fontWeight: "600",
    color: COLORS.muted,
    letterSpacing: 0.5,
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
  cardContent: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    padding: 16,
  },
  category: {
    fontFamily: "System",
    fontSize: CATEGORY_FONT_SIZE,
    fontWeight: "700",
    color: "rgba(255,255,255,0.8)",
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  title: {
    fontFamily: "System",
    fontSize: TITLE_FONT_SIZE,
    fontWeight: "700",
    color: COLORS.text,
    lineHeight: Math.round(TITLE_FONT_SIZE * 1.3),
  },
})

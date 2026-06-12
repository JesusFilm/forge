/**
 * One curated Home section rendered as a horizontal shelf.
 *
 * Layout mapping: the ported config's `layout: "rail" | "grid"` BOTH render
 * as horizontal shelves on mobile — a grid doesn't fit the vertical Home
 * feed. `orientation === "vertical"` selects portrait (3:4) cards; anything
 * else gets landscape (16:9).
 *
 * Header is eyebrow + title only — `section.description` is intentionally
 * skipped on mobile to keep shelves tight (web renders it; mobile doesn't).
 *
 * Background: none. The Home feed's renderItem wrapper owns the translucent
 * per-item background (CuratedHomeLayout's feedItemBackground convention).
 */
import { memo, useCallback } from "react"
import {
  FlatList,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"

import type { WatchHomeCard, WatchHomeSection } from "../../lib/watchHome/model"
import { useTypography } from "../../hooks/useTypography"
import {
  carousel,
  layout,
  text,
  CARD_GAP,
  HORIZONTAL_PADDING,
} from "../../styles/shared"
import { HomeCard, homeCardWidth, type HomeCardVariant } from "./HomeCard"

// ── Types ───────────────────────────────────────────────────────────────────

export type HomeShelfProps = {
  section: WatchHomeSection
}

// ── Component ───────────────────────────────────────────────────────────────

export const HomeShelf = memo(function HomeShelf({ section }: HomeShelfProps) {
  const typography = useTypography()
  const { width: screenWidth } = useWindowDimensions()

  const variant: HomeCardVariant =
    section.orientation === "vertical" ? "portrait" : "landscape"
  const cardWidth = homeCardWidth(variant, screenWidth)

  const renderItem = useCallback(
    ({ item }: { item: WatchHomeCard }) => (
      <HomeCard card={item} variant={variant} />
    ),
    [variant],
  )

  // The model already drops zero-card sections; defensive guard regardless.
  if (section.cards.length === 0) return null

  return (
    <View style={[layout.sectionOuter, styles.localContainer]}>
      {section.eyebrow.length > 0 && (
        <Text style={[text.eyebrow, styles.eyebrow, typography.caption]}>
          {section.eyebrow.toUpperCase()}
        </Text>
      )}
      <Text
        style={[text.sectionHeadingPadded, typography.heading]}
        accessibilityRole="header"
      >
        {section.title}
      </Text>
      <FlatList
        data={section.cards}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={carousel.listContent}
        snapToInterval={cardWidth + CARD_GAP}
        snapToAlignment="start"
        decelerationRate="fast"
        accessibilityLabel={`${section.cards.length} items in ${section.title}`}
      />
    </View>
  )
})

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  localContainer: {
    paddingVertical: 8,
  },
  eyebrow: {
    paddingHorizontal: HORIZONTAL_PADDING,
    marginBottom: 4,
  },
})

/**
 * One curated Home section as a horizontal shelf. Both `layout: "rail" | "grid"`
 * render as shelves; `orientation === "vertical"` selects portrait (3:4) cards,
 * else landscape (16:9). Header is the section title only — the model still
 * carries `eyebrow`, it is just not drawn here.
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
import { carousel, layout, text, CARD_GAP } from "../../styles/shared"
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
      <Text
        style={[text.sectionHeadingPadded, typography.titleSmall]}
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
})

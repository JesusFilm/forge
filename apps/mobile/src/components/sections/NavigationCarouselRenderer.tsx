import { ScrollView, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"

import { TEXT_ON_OVERLAY } from "../../lib/color"
import { resolveThumbnailUrl } from "../../lib/resolveThumbnailUrl"
import { useTypography } from "../../hooks/useTypography"
import { card, carousel, layout, text } from "../../styles/shared"
import type { AdminBlock } from "../../lib/queries"
import { PressableCard } from "../ui/PressableCard"

// ── Types ───────────────────────────────────────────────────────────────────

type NavItem = {
  contentId: string
  title: string
  category?: string | null
  imageUrl?: string | null
  backgroundColor?: string | null
}

export interface NavigationCarouselRendererProps {
  section: AdminBlock
}

// ── Constants ───────────────────────────────────────────────────────────────

const CARD_WIDTH = 110
const CARD_HEIGHT = 130

// ── Component ───────────────────────────────────────────────────────────────

export function NavigationCarouselRenderer({
  section,
}: NavigationCarouselRendererProps) {
  const typography = useTypography()
  const s = section as Record<string, unknown>
  const heading = "Stories"
  const items = (s.items as NavItem[] | undefined) ?? []

  if (items.length === 0) return null

  return (
    <View style={layout.sectionOuter}>
      <Text
        style={[text.sectionHeadingPadded, typography.heading]}
        accessibilityRole="header"
      >
        {heading}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={carousel.listContent}
        decelerationRate="fast"
        accessibilityRole="adjustable"
        accessibilityLabel={`${items.length} navigation items`}
      >
        {items.map((item, index) => {
          const imageUrl = resolveThumbnailUrl(item.imageUrl)
          const bgColor = item.backgroundColor ?? "#292524"

          return (
            <PressableCard
              key={`nav-${item.contentId}-${index}`}
              onPress={() => {
                // TODO: scroll to section via contentId
                if (__DEV__) {
                  console.log(
                    `[NavigationCarousel] Navigate to: ${item.contentId}`,
                  )
                }
              }}
              accessibilityLabel={`${item.category ?? ""} ${item.title}`.trim()}
              accessibilityHint="Scrolls to this section"
              style={[
                card.base,
                styles.localCard,
                { backgroundColor: bgColor },
              ]}
              background={
                imageUrl != null ? (
                  <Image
                    source={imageUrl}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    priority="low"
                    recyclingKey={`nav-${item.contentId}`}
                  />
                ) : undefined
              }
              scrim="subtle"
            >
              <View style={styles.cardContent}>
                {item.category != null && (
                  <Text
                    style={[styles.category, typography.caption]}
                    numberOfLines={1}
                  >
                    {item.category.toUpperCase()}
                  </Text>
                )}
                <Text
                  style={[styles.title, typography.caption]}
                  numberOfLines={2}
                >
                  {item.title}
                </Text>
              </View>
            </PressableCard>
          )
        })}
      </ScrollView>
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  localCard: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    minHeight: 48,
  },
  cardContent: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 8,
  },
  category: {
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.8)",
    fontFamily: "System",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  title: {
    fontWeight: "700",
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
  },
})

import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"

import { hexToRgba, TEXT_ON_OVERLAY } from "../../lib/color"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { useTypography } from "../../hooks/useTypography"
import { card, carousel, feedback, layout, text } from "../../styles/shared"
import type { NormalizedBlock } from "../../lib/normalizer"

// ── Types ───────────────────────────────────────────────────────────────────

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

// ── Constants ───────────────────────────────────────────────────────────────

const CARD_WIDTH = 110
const CARD_HEIGHT = 130

// ── Component ───────────────────────────────────────────────────────────────

export function NavigationCarouselRenderer({
  section,
}: NavigationCarouselRendererProps) {
  const typography = useTypography()
  const heading = (section.navHeading as string | null) ?? "Stories"
  const items = (section.items as NavItem[] | undefined) ?? []

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
          const imageUrl = resolveImageUrl(item.imageUrl ?? null)
          const bgColor = item.backgroundColor ?? "#292524"

          return (
            <Pressable
              key={`navCarousel-${item.id}-${index}`}
              testID={`nav-carousel-item-${index}`}
              style={({ pressed }) => [
                card.base,
                styles.localCard,
                { backgroundColor: bgColor },
                pressed && feedback.pressed,
              ]}
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
            >
              {imageUrl != null && (
                <Image
                  source={imageUrl}
                  style={[StyleSheet.absoluteFill, styles.cardImage]}
                  contentFit="cover"
                  priority="low"
                  recyclingKey={`nav-${item.id}`}
                />
              )}
              <LinearGradient
                colors={[hexToRgba("#000000", 0), hexToRgba("#000000", 0.7)]}
                style={[StyleSheet.absoluteFill, styles.cardImage]}
                pointerEvents="none"
              />
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
            </Pressable>
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
  cardImage: {
    borderRadius: 12,
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

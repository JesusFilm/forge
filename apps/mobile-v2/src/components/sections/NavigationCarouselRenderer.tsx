import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"

import { hexToRgba } from "../../lib/color"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { useTypography } from "../../hooks/useTypography"
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
const CARD_GAP = 12
const HORIZONTAL_PADDING = 16

// ── Component ───────────────────────────────────────────────────────────────

export function NavigationCarouselRenderer({
  section,
}: NavigationCarouselRendererProps) {
  const typography = useTypography()
  const heading = (section.navHeading as string | null) ?? "Stories"
  const items = (section.items as NavItem[] | undefined) ?? []

  if (items.length === 0) return null

  return (
    <View style={styles.container}>
      <Text
        style={[styles.sectionHeading, typography.heading]}
        accessibilityRole="header"
      >
        {heading}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
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
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: bgColor },
                pressed && styles.cardPressed,
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
  container: {
    marginVertical: 10,
  },
  sectionHeading: {
    fontWeight: "700",
    color: "#f5f5f4",
    fontFamily: "System",
    paddingHorizontal: HORIZONTAL_PADDING,
    marginBottom: 12,
  },
  scrollContent: {
    paddingHorizontal: HORIZONTAL_PADDING,
    gap: CARD_GAP,
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 12,
    overflow: "hidden",
    minHeight: 48,
  },
  cardPressed: {
    opacity: 0.85,
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
    color: "#ffffff",
    fontFamily: "System",
  },
})

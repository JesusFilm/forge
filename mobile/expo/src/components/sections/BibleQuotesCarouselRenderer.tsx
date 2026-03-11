import { useCallback, useState } from "react"
import {
  Dimensions,
  ImageBackground,
  Linking,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"

import type {
  BibleQuoteItem,
  BibleQuotesCarouselSection,
} from "../../lib/sectionModels"

const HORIZONTAL_PADDING = 24
const CARD_GAP = 12
const SCREEN_WIDTH = Dimensions.get("window").width
const CARD_WIDTH = SCREEN_WIDTH - HORIZONTAL_PADDING * 2
const SNAP_INTERVAL = CARD_WIDTH + CARD_GAP

export interface BibleQuotesCarouselRendererProps {
  section: BibleQuotesCarouselSection
}

function QuoteCard({ quote }: { quote: BibleQuoteItem }) {
  const { text, reference, attribution, backgroundImage, ctaLabel, ctaLink } =
    quote

  const handleCtaPress = () => {
    if (ctaLink) {
      void Linking.openURL(ctaLink)
    }
  }

  const cardContent = (
    // @ts-expect-error React 19 vs RN component types
    <View style={styles.cardOverlay}>
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text style={styles.quoteText} numberOfLines={6}>
        {text}
      </Text>
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text style={styles.reference}>{reference}</Text>
      {attribution != null && (
        // @ts-expect-error RN Text vs React 19 ReactNode
        <Text style={styles.attribution}>{attribution}</Text>
      )}
      {ctaLabel != null && ctaLink != null && (
        // @ts-expect-error React 19 vs RN component types
        <Pressable
          style={({ pressed }: { pressed: boolean }) => [
            styles.ctaButton,
            pressed && styles.ctaButtonPressed,
          ]}
          onPress={handleCtaPress}
          accessibilityRole="link"
          accessibilityLabel={ctaLabel}
        >
          {/* @ts-expect-error RN Text vs React 19 ReactNode */}
          <Text style={styles.ctaText}>{ctaLabel}</Text>
        </Pressable>
      )}
    </View>
  )

  if (backgroundImage) {
    return (
      // @ts-expect-error React 19 vs RN component types
      <ImageBackground
        source={{ uri: backgroundImage.url }}
        style={[styles.card, { width: CARD_WIDTH }]}
        imageStyle={styles.cardImage}
        resizeMode="cover"
        accessibilityLabel={backgroundImage.alternativeText ?? reference}
      >
        {cardContent}
      </ImageBackground>
    )
  }

  return (
    // @ts-expect-error React 19 vs RN component types
    <View style={[styles.card, styles.cardFallback, { width: CARD_WIDTH }]}>
      {cardContent}
    </View>
  )
}

function PaginationDots({
  count,
  activeIndex,
}: {
  count: number
  activeIndex: number
}) {
  if (count <= 1) return null
  return (
    // @ts-expect-error React 19 vs RN component types
    <View style={styles.dotsContainer}>
      {Array.from({ length: count }, (_, i) => (
        // @ts-expect-error React 19 vs RN component types
        <View
          key={i}
          style={[styles.dot, i === activeIndex && styles.dotActive]}
        />
      ))}
    </View>
  )
}

export function BibleQuotesCarouselRenderer({
  section,
}: BibleQuotesCarouselRendererProps) {
  const { heading, quotes } = section
  const [activeIndex, setActiveIndex] = useState(0)

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = e.nativeEvent.contentOffset.x
      const index = Math.round(offsetX / SNAP_INTERVAL)
      setActiveIndex(Math.min(Math.max(index, 0), quotes.length - 1))
    },
    [quotes.length],
  )

  return (
    // @ts-expect-error React 19 vs RN component types
    <View style={styles.container}>
      {heading != null && (
        // @ts-expect-error RN Text vs React 19 ReactNode
        <Text style={styles.heading} accessibilityRole="header">
          {heading}
        </Text>
      )}
      {quotes.length > 0 && (
        <>
          {/* @ts-expect-error React 19 vs RN component types */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            snapToInterval={SNAP_INTERVAL}
            decelerationRate="fast"
            onScroll={handleScroll}
            scrollEventThrottle={16}
            accessibilityRole="adjustable"
            accessibilityLabel={`${quotes.length} Bible quotes`}
          >
            {quotes.map((quote) => (
              // @ts-expect-error React 19 vs RN component types
              <QuoteCard key={quote.id} quote={quote} />
            ))}
          </ScrollView>
          <PaginationDots count={quotes.length} activeIndex={activeIndex} />
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
  },
  heading: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1a1a1a",
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  scrollContent: {
    paddingHorizontal: HORIZONTAL_PADDING,
    gap: CARD_GAP,
  },
  card: {
    minHeight: 200,
    borderRadius: 12,
    overflow: "hidden",
  },
  cardImage: {
    borderRadius: 12,
  },
  cardFallback: {
    backgroundColor: "#2d1b4e",
  },
  cardOverlay: {
    flex: 1,
    padding: 20,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    justifyContent: "flex-end",
  },
  quoteText: {
    fontSize: 16,
    fontStyle: "italic",
    color: "#ffffff",
    lineHeight: 24,
    marginBottom: 12,
  },
  reference: {
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.9)",
  },
  attribution: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.7)",
    marginTop: 4,
  },
  ctaButton: {
    marginTop: 12,
    alignSelf: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
  },
  ctaButtonPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.35)",
  },
  ctaText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#ffffff",
  },
  dotsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 12,
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(0, 0, 0, 0.2)",
  },
  dotActive: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
  },
})

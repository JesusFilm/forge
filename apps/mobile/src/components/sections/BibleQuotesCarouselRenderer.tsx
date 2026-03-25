import { useCallback, useState } from "react"
import {
  ImageBackground,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"

import { useTypography } from "../../hooks/useTypography"
import type {
  BibleQuoteItem,
  BibleQuotesCarouselSection,
} from "../../lib/sectionModels"
import { useNavigateLink } from "../../lib/useNavigateLink"
import { useSectionColorScheme } from "./SectionColorSchemeContext"

const HORIZONTAL_PADDING = 24
const CARD_GAP = 12

export interface BibleQuotesCarouselRendererProps {
  section: BibleQuotesCarouselSection
}

function QuoteCard({
  quote,
  cardWidth,
  onNavigate,
}: {
  quote: BibleQuoteItem
  cardWidth: number
  onNavigate: (url: string) => void
}) {
  const { text, reference, attribution, backgroundImage, ctaLabel, ctaLink } =
    quote
  const typography = useTypography()

  const handleCtaPress = () => {
    if (ctaLink) {
      onNavigate(ctaLink)
    }
  }

  const cardContent = (
    <View style={styles.cardOverlay}>
      <Text style={[styles.quoteText, typography.body]} numberOfLines={6}>
        {text}
      </Text>
      <Text style={[styles.reference, typography.bodySmall]}>{reference}</Text>
      {attribution != null && (
        <Text style={[styles.attribution, typography.caption]}>
          {attribution}
        </Text>
      )}
      {ctaLabel != null && ctaLink != null && (
        <Pressable
          style={({ pressed }: { pressed: boolean }) => [
            styles.ctaButton,
            pressed && styles.ctaButtonPressed,
          ]}
          onPress={handleCtaPress}
          accessibilityRole="link"
          accessibilityLabel={ctaLabel}
        >
          <Text style={[styles.ctaText, typography.bodySmall]}>{ctaLabel}</Text>
        </Pressable>
      )}
    </View>
  )

  if (backgroundImage) {
    return (
      <ImageBackground
        source={{ uri: backgroundImage.url }}
        style={[styles.card, { width: cardWidth }]}
        imageStyle={styles.cardImage}
        resizeMode="cover"
        accessibilityLabel={backgroundImage.alternativeText ?? reference}
      >
        {cardContent}
      </ImageBackground>
    )
  }

  return (
    <View style={[styles.card, styles.cardFallback, { width: cardWidth }]}>
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
    <View style={styles.dotsContainer}>
      {Array.from({ length: count }, (_, i) => (
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
  const onNavigate = useNavigateLink()
  const [activeIndex, setActiveIndex] = useState(0)
  const colorScheme = useSectionColorScheme()
  const isOnDark = colorScheme === "light"
  const typography = useTypography()
  const { width: screenWidth } = useWindowDimensions()

  const cardWidth = screenWidth - HORIZONTAL_PADDING * 2
  const snapInterval = cardWidth + CARD_GAP

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = e.nativeEvent.contentOffset.x
      const index = Math.round(offsetX / snapInterval)
      setActiveIndex(Math.min(Math.max(index, 0), quotes.length - 1))
    },
    [quotes.length, snapInterval],
  )

  return (
    <View style={styles.container}>
      {heading != null && (
        <Text
          style={[
            styles.heading,
            typography.heading,
            isOnDark && styles.headingLight,
          ]}
          accessibilityRole="header"
        >
          {heading}
        </Text>
      )}
      {quotes.length > 0 && (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            snapToInterval={snapInterval}
            decelerationRate="fast"
            onScroll={handleScroll}
            scrollEventThrottle={16}
            accessibilityRole="adjustable"
            accessibilityLabel={`${quotes.length} Bible quotes`}
          >
            {quotes.map((quote) => (
              <QuoteCard
                key={quote.id}
                quote={quote}
                cardWidth={cardWidth}
                onNavigate={onNavigate}
              />
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
    fontWeight: "700",
    color: "#1a1a1a",
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  headingLight: {
    color: "#ffffff",
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
    fontStyle: "italic",
    color: "#ffffff",
    marginBottom: 12,
  },
  reference: {
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.9)",
  },
  attribution: {
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

import { useCallback, useRef, useState } from "react"
import { LinearGradient } from "expo-linear-gradient"
import {
  Image,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"

import { useTypography, type TypographyScale } from "../../hooks/useTypography"
import type {
  BibleQuoteItem,
  BibleQuotesCarouselSection,
} from "../../lib/sectionModels"
import { useNavigateLink } from "../../lib/useNavigateLink"
import { useSectionColorScheme } from "./SectionColorSchemeContext"

const HORIZONTAL_PADDING = 24
const CARD_GAP = 12
const CARD_FALLBACK_COLOR = "#1A1815"

export interface BibleQuotesCarouselRendererProps {
  section: BibleQuotesCarouselSection
}

function QuoteCard({
  quote,
  cardWidth,
  typography,
  onNavigate,
}: {
  quote: BibleQuoteItem
  cardWidth: number
  typography: TypographyScale
  onNavigate: (url: string) => void
}) {
  const {
    text,
    reference,
    attribution,
    imageUrl,
    backgroundImage,
    backgroundColor,
    ctaLabel,
    ctaLink,
  } = quote
  const imageUri = imageUrl ?? backgroundImage?.url ?? null
  const bgColor = backgroundColor ?? CARD_FALLBACK_COLOR

  return (
    <View
      style={[
        styles.card,
        { width: Math.round(cardWidth), backgroundColor: bgColor },
      ]}
      accessible={true}
      accessibilityLabel={`${reference}: ${text}`}
    >
      {imageUri != null && (
        <Image
          source={{ uri: imageUri, cache: "force-cache" }}
          style={[StyleSheet.absoluteFill, styles.cardImage]}
          resizeMode="cover"
          accessibilityLabel={backgroundImage?.alternativeText ?? reference}
        />
      )}
      <LinearGradient
        colors={["transparent", bgColor]}
        locations={[0, 0.3]}
        style={styles.colorGradient}
        pointerEvents="none"
      />
      <View style={styles.cardContent}>
        {attribution != null && (
          <Text style={[styles.attribution, typography.caption]}>
            {attribution.toUpperCase()}
          </Text>
        )}
        <Text style={[styles.reference, typography.bodySmall]}>
          {reference.toUpperCase()}
        </Text>
        <Text style={[styles.quoteText, typography.body]} numberOfLines={8}>
          {text}
        </Text>
        {ctaLabel != null && ctaLink != null && (
          <Pressable
            style={({ pressed }: { pressed: boolean }) => [
              styles.ctaButton,
              pressed && styles.ctaButtonPressed,
            ]}
            onPress={() => onNavigate(ctaLink)}
            accessibilityRole="link"
            accessibilityLabel={ctaLabel}
          >
            <Text style={[styles.ctaText, typography.bodySmall]}>
              {ctaLabel}
            </Text>
          </Pressable>
        )}
      </View>
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
    <View
      style={styles.dotsContainer}
      accessibilityElementsHidden={true}
      importantForAccessibility="no-hide-descendants"
    >
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
  const scrollRef = useRef<ScrollView>(null)

  const cardWidth = Math.round(screenWidth - HORIZONTAL_PADDING * 2)
  const snapOffsets = quotes.map((_, i) => i * (cardWidth + CARD_GAP))

  const handleMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = e.nativeEvent.contentOffset.x
      const index = Math.round(offsetX / (cardWidth + CARD_GAP))
      setActiveIndex(Math.min(Math.max(index, 0), quotes.length - 1))
    },
    [quotes.length, cardWidth],
  )

  const scrollToIndex = useCallback(
    (index: number) => {
      scrollRef.current?.scrollTo({
        x: index * (cardWidth + CARD_GAP),
        animated: true,
      })
    },
    [cardWidth],
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
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            snapToOffsets={snapOffsets}
            decelerationRate="fast"
            disableIntervalMomentum
            onMomentumScrollEnd={handleMomentumScrollEnd}
            accessible={true}
            accessibilityRole="adjustable"
            accessibilityLabel={`${quotes.length} Bible quotes`}
            accessibilityValue={{
              text: `Item ${activeIndex + 1} of ${quotes.length}`,
            }}
            accessibilityActions={[
              { name: "increment", label: "Next quote" },
              { name: "decrement", label: "Previous quote" },
            ]}
            onAccessibilityAction={(event) => {
              switch (event.nativeEvent.actionName) {
                case "increment": {
                  const next = Math.min(activeIndex + 1, quotes.length - 1)
                  setActiveIndex(next)
                  scrollToIndex(next)
                  break
                }
                case "decrement": {
                  const prev = Math.max(activeIndex - 1, 0)
                  setActiveIndex(prev)
                  scrollToIndex(prev)
                  break
                }
              }
            }}
          >
            {quotes.map((quote) => (
              <QuoteCard
                key={quote.id}
                quote={quote}
                cardWidth={cardWidth}
                typography={typography}
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
    aspectRatio: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  cardImage: {
    borderRadius: 12,
  },
  colorGradient: {
    ...StyleSheet.absoluteFillObject,
    top: "40%",
  },
  cardContent: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 20,
  },
  attribution: {
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.7)",
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  reference: {
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.9)",
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  quoteText: {
    fontStyle: "italic",
    color: "#ffffff",
    marginBottom: 12,
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

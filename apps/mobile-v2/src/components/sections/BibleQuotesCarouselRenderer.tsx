import { useCallback, useRef, useState } from "react"
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"

import { hexToRgba } from "../../lib/color"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { validateActionUrl } from "../../lib/validateUrl"
import { useTypography, type TypographyScale } from "../../hooks/useTypography"
import type { NormalizedBlock } from "../../lib/normalizer"

// ── Types ───────────────────────────────────────────────────────────────────

type QuoteItem = {
  id: string
  reference: string
  text: string
  attribution?: string | null
  imageUrl?: string | null
  backgroundColor?: string | null
  ctaLabel?: string | null
  ctaLink?: string | null
}

export interface BibleQuotesCarouselRendererProps {
  section: NormalizedBlock
}

// ── Constants ───────────────────────────────────────────────────────────────

const HORIZONTAL_PADDING = 16
const CARD_GAP = 12
const FALLBACK_BG = "#292524"

// ── QuoteCard ───────────────────────────────────────────────────────────────

function QuoteCard({
  quote,
  cardWidth,
  typography,
}: {
  quote: QuoteItem
  cardWidth: number
  typography: TypographyScale
}) {
  const bgColor = quote.backgroundColor ?? FALLBACK_BG
  const bgTransparent = hexToRgba(bgColor, 0)
  const imageUrl = resolveImageUrl(quote.imageUrl ?? null)

  return (
    <View
      style={[styles.card, { width: cardWidth, backgroundColor: bgColor }]}
      accessible
      accessibilityLabel={`${quote.reference}: ${quote.text}`}
    >
      {imageUrl != null && (
        <Image
          source={imageUrl}
          style={[StyleSheet.absoluteFill, styles.cardImage]}
          contentFit="cover"
          recyclingKey={`bqc-${quote.id}`}
          accessibilityLabel={quote.reference}
        />
      )}
      <LinearGradient
        colors={[bgTransparent, bgColor]}
        locations={[0, 0.5]}
        style={styles.gradient}
        pointerEvents="none"
      />
      <View style={styles.cardContent}>
        {quote.attribution != null && (
          <Text style={[styles.attribution, typography.caption]}>
            {quote.attribution.toUpperCase()}
          </Text>
        )}
        <Text style={[styles.reference, typography.bodySmall]}>
          {quote.reference.toUpperCase()}
        </Text>
        <Text style={[styles.quoteText, typography.body]} numberOfLines={8}>
          {quote.text}
        </Text>
        {quote.ctaLabel != null &&
          quote.ctaLink != null &&
          validateActionUrl(quote.ctaLink) && (
            <Pressable
              style={({ pressed }) => [
                styles.ctaButton,
                pressed && styles.ctaButtonPressed,
              ]}
              accessibilityRole="link"
              accessibilityLabel={quote.ctaLabel}
            >
              <Text style={[styles.ctaText, typography.bodySmall]}>
                {quote.ctaLabel}
              </Text>
            </Pressable>
          )}
      </View>
    </View>
  )
}

// ── Pagination ──────────────────────────────────────────────────────────────

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
      accessibilityElementsHidden
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

// ── Main Component ──────────────────────────────────────────────────────────

export function BibleQuotesCarouselRenderer({
  section,
}: BibleQuotesCarouselRendererProps) {
  const typography = useTypography()
  const { width: screenWidth } = useWindowDimensions()
  const flatListRef = useRef<FlatList<QuoteItem>>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  const heading = section.bqcHeading as string | null
  const quotes = (section.quotes as QuoteItem[] | undefined) ?? []

  const cardWidth = Math.round(screenWidth - HORIZONTAL_PADDING * 2)

  const handleMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = e.nativeEvent.contentOffset.x
      const index = Math.round(offsetX / (cardWidth + CARD_GAP))
      setActiveIndex(Math.min(Math.max(index, 0), quotes.length - 1))
    },
    [quotes.length, cardWidth],
  )

  const scrollToIndex = useCallback((index: number) => {
    flatListRef.current?.scrollToIndex({ index, animated: true })
  }, [])

  const renderQuoteItem = useCallback(
    ({ item }: { item: QuoteItem }) => (
      <QuoteCard
        key={`bqc-${item.id}`}
        quote={item}
        cardWidth={cardWidth}
        typography={typography}
      />
    ),
    [cardWidth, typography],
  )

  const keyExtractor = useCallback((item: QuoteItem) => `bqc-${item.id}`, [])

  const getItemLayout = useCallback(
    (_data: ArrayLike<QuoteItem> | null | undefined, index: number) => ({
      length: cardWidth + CARD_GAP,
      offset: index * (cardWidth + CARD_GAP),
      index,
    }),
    [cardWidth],
  )

  if (quotes.length === 0) return null

  return (
    <View style={styles.container}>
      {heading != null && (
        <Text
          style={[styles.heading, typography.heading]}
          accessibilityRole="header"
        >
          {heading}
        </Text>
      )}
      <FlatList
        ref={flatListRef}
        data={quotes}
        renderItem={renderQuoteItem}
        keyExtractor={keyExtractor}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        snapToInterval={cardWidth + CARD_GAP}
        decelerationRate="fast"
        initialNumToRender={2}
        windowSize={3}
        getItemLayout={getItemLayout}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        accessible
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
      />
      <PaginationDots count={quotes.length} activeIndex={activeIndex} />
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
  },
  heading: {
    fontWeight: "700",
    color: "#f5f5f4",
    fontFamily: "System",
    paddingHorizontal: HORIZONTAL_PADDING,
    marginBottom: 16,
  },
  scrollContent: {
    paddingHorizontal: HORIZONTAL_PADDING,
    gap: CARD_GAP,
  },
  card: {
    aspectRatio: 4 / 3,
    borderRadius: 12,
    overflow: "hidden",
  },
  cardImage: {
    borderRadius: 12,
  },
  gradient: {
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
    fontFamily: "System",
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  reference: {
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.9)",
    fontFamily: "System",
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  quoteText: {
    fontStyle: "italic",
    color: "#ffffff",
    fontFamily: "System",
    marginBottom: 12,
  },
  ctaButton: {
    marginTop: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    minHeight: 48,
    justifyContent: "center",
  },
  ctaButtonPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.35)",
  },
  ctaText: {
    fontWeight: "600",
    color: "#ffffff",
    fontFamily: "System",
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
    backgroundColor: "rgba(255, 255, 255, 0.2)",
  },
  dotActive: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(255, 255, 255, 0.7)",
  },
})

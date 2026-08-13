import { useCallback, useRef, useState } from "react"
import {
  FlatList,
  Linking,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import Ionicons from "@expo/vector-icons/Ionicons"

import { ACCENT, TEXT_ON_OVERLAY, hexToRgba } from "../../lib/color"
import { layout, text, button, card, carousel } from "../../styles/shared"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { validateActionUrl } from "../../lib/validateUrl"
import { useTypography, type TypographyScale } from "../../hooks/useTypography"
import type { AdminBlock } from "../../lib/queries"

// ── Types ───────────────────────────────────────────────────────────────────

type QuoteItem = {
  reference: string
  text: string
  attribution?: string | null
  imageUrl?: string | null
  backgroundColor?: string | null
  ctaLabel?: string | null
  ctaLink?: string | null
}

export interface BibleQuotesCarouselRendererProps {
  section: AdminBlock
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
      style={[
        card.base,
        styles.localCard,
        { width: cardWidth, backgroundColor: bgColor },
      ]}
      accessible
      accessibilityLabel={`${quote.reference}: ${quote.text}`}
    >
      {imageUrl != null && (
        <Image
          source={imageUrl}
          style={[StyleSheet.absoluteFill, styles.cardImage]}
          contentFit="cover"
          recyclingKey={`bqc-${quote.reference}`}
          accessibilityLabel={quote.reference}
        />
      )}
      <LinearGradient
        colors={[bgTransparent, bgColor]}
        locations={[0, 0.6]}
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
        <Text style={[styles.quoteText, typography.body]}>{quote.text}</Text>
        {(() => {
          const ctaLink = quote.ctaLink
          const ctaLabel = quote.ctaLabel
          if (
            ctaLabel == null ||
            ctaLink == null ||
            !validateActionUrl(ctaLink)
          )
            return null
          return (
            <Pressable
              style={({ pressed }) => [
                styles.ctaButton,
                pressed && styles.ctaButtonPressed,
              ]}
              onPress={() => Linking.openURL(ctaLink)}
              accessibilityRole="link"
              accessibilityLabel={ctaLabel}
            >
              <Text style={[styles.ctaText, typography.bodySmall]}>
                {ctaLabel}
              </Text>
            </Pressable>
          )
        })()}
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

  const s = section as Record<string, unknown>
  const heading = s.heading as string | null
  const quotes = (s.quotes as QuoteItem[] | undefined) ?? []

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
    ({ item, index }: { item: QuoteItem; index: number }) => (
      <QuoteCard
        key={`bqc-${index}`}
        quote={item}
        cardWidth={cardWidth}
        typography={typography}
      />
    ),
    [cardWidth, typography],
  )

  const keyExtractor = useCallback(
    (_item: QuoteItem, index: number) => `bqc-${index}`,
    [],
  )

  const getItemLayout = useCallback(
    (_data: ArrayLike<QuoteItem> | null | undefined, index: number) => ({
      length: cardWidth + CARD_GAP,
      offset: index * (cardWidth + CARD_GAP),
      index,
    }),
    [cardWidth],
  )

  const handleShare = useCallback(async () => {
    try {
      await Share.share({
        message:
          "Check out the JesusFilm app!\nhttps://www.jesusfilm.org/watch",
      })
    } catch {
      // User dismissed or share unavailable
    }
  }, [])

  if (quotes.length === 0) return null

  return (
    <View style={layout.sectionOuter}>
      <View style={[layout.headerRow, styles.localHeaderRow]}>
        {heading != null && (
          <Text
            style={[
              text.sectionHeading,
              styles.localHeading,
              typography.titleLarge,
            ]}
            accessibilityRole="header"
          >
            {heading}
          </Text>
        )}
        <Pressable
          onPress={handleShare}
          style={[button.iconButton44, styles.localShareButton]}
          accessibilityRole="button"
          accessibilityLabel="Share"
        >
          <Ionicons name="share-outline" size={22} color={ACCENT} />
        </Pressable>
      </View>
      <FlatList
        ref={flatListRef}
        data={quotes}
        renderItem={renderQuoteItem}
        keyExtractor={keyExtractor}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={carousel.listContent}
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
  localHeaderRow: {
    paddingHorizontal: HORIZONTAL_PADDING,
    marginBottom: 16,
  },
  localHeading: {
    flex: 1,
  },
  localShareButton: {
    marginLeft: "auto",
  },
  localCard: {
    overflow: "hidden",
    aspectRatio: 1,
  },
  cardImage: {
    borderRadius: 12,
  },
  gradient: {
    ...StyleSheet.absoluteFill,
    top: "20%",
  },
  cardContent: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 20,
  },
  attribution: {
    fontWeight: "800",
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  reference: {
    fontWeight: "800",
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  quoteText: {
    fontStyle: "italic",
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    marginBottom: 4,
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
    color: TEXT_ON_OVERLAY,
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

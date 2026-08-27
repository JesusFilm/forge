import { useCallback, useRef, useState } from "react"
import {
  Animated,
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
import {
  COPYRIGHT_MAX_LINES,
  composeCardLabel,
  fitPassageCardRegions,
} from "../../lib/bibleCardFit"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { validateActionUrl } from "../../lib/validateUrl"
import { useShimmerOpacity } from "../../hooks/useShimmerOpacity"
import { useTypography, type TypographyScale } from "../../hooks/useTypography"
import type { AdminBlock } from "../../lib/queries"

// ── Types ───────────────────────────────────────────────────────────────────

// The passage-only fields are OPTIONAL on purpose: this renderer also serves
// the Experience and SDUI content paths, whose quote items carry none of them.
// Rendering each region only when its value is present is what keeps those two
// surfaces byte-identical to today.
type QuoteItem = {
  reference: string
  text: string
  attribution?: string | null
  imageUrl?: string | null
  backgroundColor?: string | null
  ctaLabel?: string | null
  ctaLink?: string | null
  translation?: string | null
  copyright?: string | null
  passageUrl?: string | null
  loading?: boolean
}

export interface BibleQuotesCarouselRendererProps {
  section: AdminBlock
}

// ── Constants ───────────────────────────────────────────────────────────────

const HORIZONTAL_PADDING = 16
const CARD_GAP = 12
const FALLBACK_BG = "#292524"
// Keep in step with `cardContent`'s padding — the fit arithmetic subtracts it.
const CARD_CONTENT_PADDING = 20
const READ_PASSAGE_LABEL = "Read full passage"

// ── QuoteCard ───────────────────────────────────────────────────────────────

/** Reserved-height stand-in for the verse while the passage read is in flight. */
function VerseLoading({ typography }: { typography: TypographyScale }) {
  const opacity = useShimmerOpacity()
  return (
    <Animated.View
      style={[styles.verseLoading, { opacity }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {[0.95, 0.85, 0.6].map((widthFraction) => (
        <View
          key={widthFraction}
          style={[
            styles.verseLoadingBar,
            {
              height: Math.round(typography.body.lineHeight * 0.6),
              width: `${widthFraction * 100}%`,
            },
          ]}
        />
      ))}
    </Animated.View>
  )
}

function QuoteCard({
  quote,
  cardWidth,
  typography,
  fontScale,
  onOpenPassage,
}: {
  quote: QuoteItem
  cardWidth: number
  typography: TypographyScale
  fontScale: number
  onOpenPassage?: (url: string) => void
}) {
  const bgColor = quote.backgroundColor ?? FALLBACK_BG
  const bgTransparent = hexToRgba(bgColor, 0)
  const imageUrl = resolveImageUrl(quote.imageUrl ?? null)
  const loading = quote.loading === true

  const passageUrl =
    quote.passageUrl != null && validateActionUrl(quote.passageUrl)
      ? quote.passageUrl
      : null

  // R14: only a passage-fed card has credit to protect, so only it takes the
  // clamp and the drop order. The Experience and SDUI cards carry none of
  // these fields and keep today's unclamped verse.
  const hasPassage =
    quote.translation != null ||
    quote.copyright != null ||
    quote.passageUrl != null

  const showVerse = !loading && quote.text.length > 0

  // The card is a fixed square and its content is bottom-aligned, so the drop
  // order has to be decided here rather than left to overflow.
  const regions = fitPassageCardRegions({
    contentHeight: cardWidth - CARD_CONTENT_PADDING * 2,
    typography,
    fontScale,
    hasVerse: showVerse,
    hasTranslation: !loading && quote.translation != null,
    hasCopyright: !loading && quote.copyright != null,
    hasLink: !loading && passageUrl != null,
  })

  return (
    <View
      style={[
        card.base,
        styles.localCard,
        { width: cardWidth, backgroundColor: bgColor },
      ]}
      accessible
      accessibilityLabel={
        loading
          ? `${quote.reference}, loading`
          : composeCardLabel(quote.reference, quote.text)
      }
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
        {loading && <VerseLoading typography={typography} />}
        {showVerse && (
          <Text
            style={[styles.quoteText, typography.body]}
            numberOfLines={hasPassage ? regions.verseLines : undefined}
          >
            {quote.text}
          </Text>
        )}
        {regions.translation && quote.translation != null && (
          <Text style={[styles.translation, typography.caption]}>
            {quote.translation}
          </Text>
        )}
        {regions.copyright && quote.copyright != null && (
          <Text
            style={[styles.copyright, typography.caption]}
            numberOfLines={COPYRIGHT_MAX_LINES}
          >
            {quote.copyright}
          </Text>
        )}
        {regions.link && passageUrl != null && (
          <Pressable
            style={({ pressed }) => [
              styles.passageLink,
              onOpenPassage == null && styles.passageLinkDisabled,
              pressed && styles.passageLinkPressed,
            ]}
            // U6 supplies the handler. A link with no handler must never be
            // tappable, so the affordance disables itself rather than
            // depending on landing order.
            disabled={onOpenPassage == null}
            onPress={() => onOpenPassage?.(passageUrl)}
            accessibilityRole="link"
            accessibilityLabel={READ_PASSAGE_LABEL}
          >
            <Text style={[styles.passageLinkText, typography.bodySmall]}>
              {READ_PASSAGE_LABEL}
            </Text>
          </Pressable>
        )}
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
  const { width: screenWidth, fontScale } = useWindowDimensions()
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
        fontScale={fontScale}
      />
    ),
    [cardWidth, typography, fontScale],
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
    marginBottom: 6,
  },
  // NOT routed through `attribution` above: that field renders as an uppercase
  // heavy eyebrow, which is wrong for a translation name and a copyright line.
  translation: {
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.65)",
    fontFamily: "System",
    marginBottom: 2,
  },
  copyright: {
    color: "rgba(255, 255, 255, 0.55)",
    fontFamily: "System",
  },
  passageLink: {
    marginTop: 8,
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
  },
  passageLinkDisabled: {
    opacity: 0.5,
  },
  passageLinkPressed: {
    opacity: 0.7,
  },
  passageLinkText: {
    fontWeight: "600",
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    textDecorationLine: "underline",
  },
  verseLoading: {
    marginBottom: 6,
    gap: 6,
  },
  verseLoadingBar: {
    borderRadius: 4,
    backgroundColor: "rgba(255, 255, 255, 0.22)",
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

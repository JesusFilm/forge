import React, { useCallback, useState } from "react"
import { FlatList, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"

import type { NormalizedBlock } from "../../lib/normalizer"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { hexToRgba } from "../../lib/colors"
import { scale } from "../../lib/scale"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { validateActionUrl } from "../../lib/validateUrl"
import { FocusableCard } from "../FocusableCard"
import { LinkModal } from "../LinkModal"
import { SECTION_HEADING } from "./sectionHeading"

// ── Constants ────────────────────────────────────────────────────────────────

const CARD_SIZE = scale(340)
const CARD_GAP = scale(24)

// At 5+ cards the row overflows the 1920-wide canvas, so a centered list
// pushes the first card's left edge off-screen. Left-align past this count
// so the first card is fully visible (matching the VideoCarousel rail).
const LEFT_ALIGN_THRESHOLD = 5

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── QuoteCard ────────────────────────────────────────────────────────────────

function QuoteCard({
  quote,
  ctaLabel,
  onPress,
  focusAnchor,
}: {
  quote: QuoteItem
  ctaLabel: string | null
  onPress: () => void
  focusAnchor: "center" | "left"
}) {
  const imageSource = resolveImageUrl(quote.imageUrl ?? null)
  const bgColor = quote.backgroundColor ?? "#292524"

  return (
    <FocusableCard
      onPress={onPress}
      focusAnchor={focusAnchor}
      style={{ ...styles.card, backgroundColor: bgColor }}
      accessibilityLabel={`${quote.reference}: ${quote.text}`}
    >
      {imageSource != null && (
        <Image
          source={imageSource}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          contentPosition="top left"
          recyclingKey={`bqc-${quote.id}`}
        />
      )}
      <LinearGradient
        colors={[hexToRgba(bgColor, 0), bgColor]}
        locations={[0, 0.6]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={styles.cardContent}>
        {quote.attribution != null && quote.attribution.length > 0 && (
          <Text style={styles.attribution} numberOfLines={1}>
            {quote.attribution.toUpperCase()}
          </Text>
        )}
        <Text style={styles.reference} numberOfLines={1}>
          {quote.reference.toUpperCase()}
        </Text>
        <Text style={styles.quoteText} numberOfLines={6}>
          {quote.text}
        </Text>
        {ctaLabel != null && (
          <View style={styles.ctaButton}>
            <Text style={styles.ctaText}>{ctaLabel}</Text>
          </View>
        )}
      </View>
    </FocusableCard>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export function BibleQuotesCarouselRenderer({
  section,
}: BibleQuotesCarouselRendererProps) {
  const heading = section.bqcHeading as string | null
  const quotes = (section.quotes as QuoteItem[] | undefined) ?? []
  const [selectedCtaUrl, setSelectedCtaUrl] = useState<string | null>(null)
  // 5+ cards left-align the rail (see listContentLeftAligned below); only then
  // is the first card flush against the screen's left edge, so only then should
  // its focus-scale anchor to the left. A centered short rail keeps it centered.
  const leftAligned = quotes.length >= LEFT_ALIGN_THRESHOLD

  const renderItem = useCallback(
    ({ item, index }: { item: QuoteItem; index: number }) => {
      const hasValidCta =
        item.ctaLabel != null &&
        item.ctaLink != null &&
        validateActionUrl(item.ctaLink)
      const validCtaLink = hasValidCta ? item.ctaLink : null
      const validCtaLabel = hasValidCta ? (item.ctaLabel ?? null) : null

      return (
        <View style={styles.cardWrapper}>
          <QuoteCard
            quote={item}
            ctaLabel={validCtaLabel}
            focusAnchor={leftAligned && index === 0 ? "left" : "center"}
            onPress={() => {
              if (validCtaLink != null) {
                setSelectedCtaUrl(validCtaLink)
              }
            }}
          />
        </View>
      )
    },
    [leftAligned],
  )

  const keyExtractor = useCallback(
    (item: QuoteItem, index: number) => `bqc-${item.id}-${index}`,
    [],
  )

  if (quotes.length === 0) return null

  return (
    <View style={styles.container}>
      {heading != null && (
        <Text style={styles.heading} accessibilityRole="header">
          {heading}
        </Text>
      )}
      <TVFocusGuideView autoFocus>
        <FlatList
          data={quotes}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[
            styles.listContent,
            leftAligned && styles.listContentLeftAligned,
          ]}
          ItemSeparatorComponent={Separator}
        />
      </TVFocusGuideView>
      {selectedCtaUrl != null && (
        <LinkModal
          url={selectedCtaUrl}
          visible
          onClose={() => setSelectedCtaUrl(null)}
          urlValidator={validateActionUrl}
          errorText="Couldn't load the page."
          qrHeading="Scan to visit on your phone"
        />
      )}
    </View>
  )
}

function Separator() {
  return <View style={styles.separator} />
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginBottom: scale(32),
  },
  heading: {
    ...SECTION_HEADING,
    marginBottom: scale(12),
    paddingHorizontal: scale(80),
  },
  listContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  listContentLeftAligned: {
    justifyContent: "flex-start",
    paddingHorizontal: scale(80),
  },
  cardWrapper: {
    paddingVertical: scale(40),
  },
  separator: {
    width: CARD_GAP,
  },
  card: {
    width: CARD_SIZE,
    height: CARD_SIZE,
    borderRadius: scale(16),
    overflow: "hidden",
  },
  cardContent: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    padding: scale(20),
  },
  attribution: {
    fontFamily: "System",
    fontSize: Math.round(scale(14)),
    fontWeight: "800",
    color: "rgba(255,255,255,0.9)",
    letterSpacing: 0.8,
    marginBottom: scale(2),
  },
  reference: {
    fontFamily: "System",
    fontSize: Math.round(scale(16)),
    fontWeight: "800",
    color: "rgba(255,255,255,0.7)",
    letterSpacing: 1.5,
    marginBottom: scale(6),
  },
  quoteText: {
    fontFamily: "System",
    fontSize: Math.round(scale(18)),
    fontWeight: "400",
    fontStyle: "italic",
    color: "rgba(255,255,255,0.9)",
    lineHeight: Math.round(scale(26)),
  },
  ctaButton: {
    marginTop: scale(12),
    alignSelf: "flex-start",
    paddingHorizontal: scale(16),
    paddingVertical: scale(8),
    borderRadius: scale(20),
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  ctaText: {
    fontFamily: "System",
    fontSize: Math.round(scale(14)),
    fontWeight: "600",
    color: "rgba(255,255,255,0.9)",
  },
})

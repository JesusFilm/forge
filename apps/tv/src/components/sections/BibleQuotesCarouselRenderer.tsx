import React, { useCallback } from "react"
import {
  FlatList,
  StyleSheet,
  Text,
  View,
  // @ts-expect-error TVFocusGuideView is provided by react-native-tvos but not in base RN types
  TVFocusGuideView,
} from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"

import type { NormalizedBlock } from "../../lib/normalizer"
import { COLORS, hexToRgba } from "../../lib/colors"
import { scale } from "../../lib/scale"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { FocusableCard } from "../FocusableCard"

// ── Constants ────────────────────────────────────────────────────────────────

const CARD_SIZE = scale(340)
const CARD_GAP = scale(24)

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

function QuoteCard({ quote }: { quote: QuoteItem }) {
  const imageSource = resolveImageUrl(quote.imageUrl ?? null)
  const bgColor = quote.backgroundColor ?? "#292524"

  return (
    <FocusableCard
      onPress={() => {
        console.log("[BibleQuotesCarousel] Selected:", quote.reference)
      }}
      style={{ ...styles.card, backgroundColor: bgColor }}
      accessibilityLabel={`${quote.reference}: ${quote.text}`}
    >
      {imageSource != null && (
        <Image
          source={imageSource}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
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

  const renderItem = useCallback(
    ({ item }: { item: QuoteItem }) => (
      <View style={styles.cardWrapper}>
        <QuoteCard quote={item} />
      </View>
    ),
    [],
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
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={Separator}
        />
      </TVFocusGuideView>
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
    fontFamily: "System",
    fontSize: scale(20),
    fontWeight: "600",
    color: COLORS.muted,
    letterSpacing: 0.5,
    marginBottom: scale(12),
    paddingHorizontal: scale(80),
  },
  listContent: {
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
    fontSize: scale(14),
    fontWeight: "800",
    color: "rgba(255,255,255,0.9)",
    letterSpacing: 0.8,
    marginBottom: scale(2),
  },
  reference: {
    fontFamily: "System",
    fontSize: scale(16),
    fontWeight: "800",
    color: "rgba(255,255,255,0.7)",
    letterSpacing: 1.5,
    marginBottom: scale(6),
  },
  quoteText: {
    fontFamily: "System",
    fontSize: scale(18),
    fontWeight: "400",
    fontStyle: "italic",
    color: "rgba(255,255,255,0.9)",
    lineHeight: scale(26),
  },
})

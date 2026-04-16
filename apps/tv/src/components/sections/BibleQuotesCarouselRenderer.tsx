import React, { useCallback } from "react"
import {
  FlatList,
  StyleSheet,
  Text,
  View,
  // @ts-expect-error TVFocusGuideView is provided by react-native-tvos but not in base RN types
  TVFocusGuideView,
} from "react-native"

import type { NormalizedBlock } from "../../lib/normalizer"
import { scale } from "../../lib/scale"
import { FocusableCard } from "../FocusableCard"

// ── Constants ────────────────────────────────────────────────────────────────

const CARD_WIDTH = scale(400)
const CARD_GAP = scale(24)

const COLORS = {
  surfaceContainer: "#221F1D",
  crimson: "#CB333B",
  text: "#F5F5F4",
  muted: "#A8A29E",
} as const

// ── Types ────────────────────────────────────────────────────────────────────

type QuoteItem = {
  id: string
  reference: string
  text: string
  attribution?: string | null
}

export interface BibleQuotesCarouselRendererProps {
  section: NormalizedBlock
}

// ── QuoteCard ────────────────────────────────────────────────────────────────

function QuoteCard({ quote }: { quote: QuoteItem }) {
  return (
    <FocusableCard
      onPress={() => {
        console.log("[BibleQuotesCarousel] Selected:", quote.reference)
      }}
      style={styles.card}
    >
      <Text style={styles.reference}>{quote.reference}</Text>
      <Text style={styles.quoteText}>{quote.text}</Text>
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
    width: CARD_WIDTH,
    backgroundColor: COLORS.surfaceContainer,
    borderRadius: scale(16),
    padding: scale(24),
  },
  reference: {
    fontFamily: "System",
    fontSize: scale(18),
    fontWeight: "500",
    color: COLORS.crimson,
    marginBottom: scale(12),
  },
  quoteText: {
    fontFamily: "System",
    fontSize: scale(20),
    fontWeight: "400",
    color: COLORS.text,
    lineHeight: scale(30),
  },
})

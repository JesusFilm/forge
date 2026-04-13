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
import { FocusableCard } from "../FocusableCard"

// ── Constants ────────────────────────────────────────────────────────────────

const CARD_WIDTH = 400
const CARD_GAP = 24

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
    ({ item }: { item: QuoteItem }) => <QuoteCard quote={item} />,
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
    marginBottom: 32,
  },
  heading: {
    fontFamily: "System",
    fontSize: 20,
    fontWeight: "600",
    color: COLORS.muted,
    letterSpacing: 0.5,
    marginBottom: 12,
    paddingHorizontal: 80,
  },
  listContent: {
    paddingHorizontal: 80,
  },
  separator: {
    width: CARD_GAP,
  },
  card: {
    width: CARD_WIDTH,
    backgroundColor: COLORS.surfaceContainer,
    borderRadius: 16,
    padding: 24,
  },
  reference: {
    fontFamily: "System",
    fontSize: 18,
    fontWeight: "500",
    color: COLORS.crimson,
    marginBottom: 12,
  },
  quoteText: {
    fontFamily: "System",
    fontSize: 20,
    fontWeight: "400",
    color: COLORS.text,
    lineHeight: 30,
  },
})

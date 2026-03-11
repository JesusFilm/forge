import {
  ImageBackground,
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
import { useNavigateLink } from "../../lib/useNavigateLink"
import { useSectionColorScheme } from "./SectionColorSchemeContext"

export interface BibleQuotesCarouselRendererProps {
  section: BibleQuotesCarouselSection
}

function QuoteCard({
  quote,
  onNavigate,
}: {
  quote: BibleQuoteItem
  onNavigate: (url: string) => void
}) {
  const { text, reference, attribution, backgroundImage, ctaLabel, ctaLink } =
    quote

  const handleCtaPress = () => {
    if (ctaLink) {
      onNavigate(ctaLink)
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
        style={styles.card}
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
    <View style={[styles.card, styles.cardFallback]}>{cardContent}</View>
  )
}

export function BibleQuotesCarouselRenderer({
  section,
}: BibleQuotesCarouselRendererProps) {
  const { heading, quotes } = section
  const onNavigate = useNavigateLink()
  const colorScheme = useSectionColorScheme()
  const isOnDark = colorScheme === "light"

  return (
    // @ts-expect-error React 19 vs RN component types
    <View style={styles.container}>
      {heading != null && (
        // @ts-expect-error RN Text vs React 19 ReactNode
        <Text
          style={[styles.heading, isOnDark && styles.headingLight]}
          accessibilityRole="header"
        >
          {heading}
        </Text>
      )}
      {quotes.length > 0 && (
        // @ts-expect-error React 19 vs RN component types
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          accessibilityRole="adjustable"
          accessibilityLabel={`${quotes.length} Bible quotes`}
        >
          {quotes.map((quote) => (
            // @ts-expect-error React 19 vs RN component types
            <QuoteCard key={quote.id} quote={quote} onNavigate={onNavigate} />
          ))}
        </ScrollView>
      )}
    </View>
  )
}

const CARD_WIDTH = 280

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
  headingLight: {
    color: "#ffffff",
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 12,
  },
  card: {
    width: CARD_WIDTH,
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
})

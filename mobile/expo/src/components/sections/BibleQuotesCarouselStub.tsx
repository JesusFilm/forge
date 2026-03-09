import { StyleSheet, Text, View } from "react-native"

import type { BibleQuotesCarouselSection } from "../../lib/sectionModels"

export interface BibleQuotesCarouselRendererProps {
  section: BibleQuotesCarouselSection
}

export function BibleQuotesCarouselRenderer({
  section,
}: BibleQuotesCarouselRendererProps) {
  return (
    // @ts-expect-error React 19 vs RN component types
    <View style={styles.container}>
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text style={styles.label}>BibleQuotesCarousel</Text>
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text style={styles.detail}>
        {section.heading ?? section.id} · {section.quotes.length} quotes
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    marginVertical: 4,
    backgroundColor: "#fff8e1",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ffe082",
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: "#f57f17",
    marginBottom: 4,
  },
  detail: {
    fontSize: 13,
    color: "#333",
  },
})

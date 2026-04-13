import { StyleSheet, Text, View } from "react-native"

import type { NormalizedBlock } from "../../lib/normalizer"

// ── Constants ────────────────────────────────────────────────────────────────

const COLORS = {
  text: "#F5F5F4",
  muted: "#A8A29E",
} as const

// ── Types ────────────────────────────────────────────────────────────────────

export interface TextRendererProps {
  section: NormalizedBlock
}

// ── Component ────────────────────────────────────────────────────────────────

export function TextRenderer({ section }: TextRendererProps) {
  const heading = section.textHeading as string | null
  const rawParagraphs = section.contentParagraphs

  // contentParagraphs is a Strapi JSON field that should be string[]
  const paragraphs: string[] = Array.isArray(rawParagraphs)
    ? (rawParagraphs as string[])
    : []

  return (
    <View style={styles.container}>
      {heading != null && (
        <Text style={styles.heading} accessibilityRole="header">
          {heading}
        </Text>
      )}
      {paragraphs.map((paragraph, index) => (
        <Text
          key={`text-p-${index}`}
          style={[
            styles.paragraph,
            index < paragraphs.length - 1 && styles.paragraphSpacing,
          ]}
        >
          {paragraph}
        </Text>
      ))}
    </View>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 80,
    paddingVertical: 32,
  },
  heading: {
    fontFamily: "System",
    fontSize: 28,
    fontWeight: "bold",
    color: COLORS.text,
    marginBottom: 16,
  },
  paragraph: {
    fontFamily: "System",
    fontSize: 22,
    fontWeight: "400",
    color: COLORS.muted,
    lineHeight: 33,
  },
  paragraphSpacing: {
    marginBottom: 16,
  },
})

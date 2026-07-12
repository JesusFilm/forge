import { StyleSheet, Text, View } from "react-native"

import type { NormalizedBlock } from "../../lib/normalizer"
import { scale } from "../../lib/scale"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import { SECTION_HEADING } from "./sectionHeading"

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
    paddingHorizontal: scale(80),
    paddingVertical: scale(32),
  },
  heading: {
    ...SECTION_HEADING,
    marginBottom: scale(16),
  },
  paragraph: {
    fontFamily: "System",
    fontSize: Math.round(scale(24)),
    fontWeight: "400",
    color: WATCH_THEME.text,
    lineHeight: Math.round(scale(36)),
  },
  paragraphSpacing: {
    marginBottom: scale(16),
  },
})

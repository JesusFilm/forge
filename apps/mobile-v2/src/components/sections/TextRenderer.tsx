import { useCallback, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"

import {
  ACCENT,
  TEXT_BODY,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../../lib/color"
import { useTypography } from "../../hooks/useTypography"
import type { NormalizedBlock } from "../../lib/normalizer"

// ── Types ───────────────────────────────────────────────────────────────────

type HeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6"

export interface TextRendererProps {
  section: NormalizedBlock
}

const COLLAPSED_LINES = 3

// ── Component ───────────────────────────────────────────────────────────────

export function TextRenderer({ section }: TextRendererProps) {
  const typography = useTypography()
  const [expanded, setExpanded] = useState(false)

  const heading = section.textHeading as string | null
  const headingLevel = (section.headingLevel as HeadingLevel | null) ?? "h2"
  const subtitle = section.subtitle as string | null
  const rawParagraphs = section.contentParagraphs
  const variant = section.textVariant as string | null

  // contentParagraphs is a Strapi JSON field that should be string[]
  const paragraphs: string[] = Array.isArray(rawParagraphs)
    ? (rawParagraphs as string[])
    : []

  const isLead = variant === "lead"
  const headingToken = typography.headingScale[headingLevel]
  const needsToggle = paragraphs.length > COLLAPSED_LINES
  const visibleParagraphs =
    needsToggle && !expanded ? paragraphs.slice(0, COLLAPSED_LINES) : paragraphs

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev)
  }, [])

  return (
    <View style={[styles.container, isLead && styles.containerLead]}>
      {subtitle != null && (
        <Text style={[styles.subtitle, typography.body]}>{subtitle}</Text>
      )}
      {heading != null && (
        <Text style={[styles.heading, headingToken]} accessibilityRole="header">
          {heading}
        </Text>
      )}
      {visibleParagraphs.map((paragraph, index) => (
        <Text
          key={`text-p-${index}`}
          style={[
            styles.paragraph,
            typography.body,
            index < visibleParagraphs.length - 1 && styles.paragraphSpacing,
          ]}
        >
          {paragraph}
        </Text>
      ))}
      {needsToggle && (
        <Pressable
          onPress={handleToggle}
          style={styles.toggleButton}
          accessibilityRole="button"
          accessibilityLabel={expanded ? "Show less" : "Read more"}
        >
          <Text style={[styles.toggleText, typography.bodySmall]}>
            {expanded ? "Show less" : "Read more"}
          </Text>
        </Pressable>
      )}
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginVertical: 10,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  containerLead: {
    paddingVertical: 24,
  },
  heading: {
    fontWeight: "700",
    color: TEXT_PRIMARY,
    fontFamily: "System",
    marginBottom: 8,
  },
  subtitle: {
    fontWeight: "500",
    color: TEXT_SECONDARY,
    fontFamily: "System",
    marginBottom: 4,
  },
  paragraph: {
    color: TEXT_BODY,
    fontFamily: "System",
  },
  paragraphSpacing: {
    marginBottom: 12,
  },
  toggleButton: {
    marginTop: 8,
    minHeight: 48,
    justifyContent: "center",
  },
  toggleText: {
    fontWeight: "600",
    color: ACCENT,
    fontFamily: "System",
  },
})

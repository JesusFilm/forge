import { useCallback, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"

import { TEXT_BODY } from "../../lib/color"
import { useTypography } from "../../hooks/useTypography"
import { layout, text } from "../../styles/shared"
import type { AdminBlock } from "../../lib/queries"

// ── Types ───────────────────────────────────────────────────────────────────

type HeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6"

export interface TextRendererProps {
  section: AdminBlock
}

const COLLAPSED_LINES = 3

// ── Component ───────────────────────────────────────────────────────────────

export function TextRenderer({ section }: TextRendererProps) {
  const typography = useTypography()
  const [expanded, setExpanded] = useState(false)

  const s = section as Record<string, unknown>
  const heading = s.heading as string | null
  const headingLevel = (s.headingLevel as HeadingLevel | null) ?? "h2"
  const subtitle = s.subtitle as string | null
  const rawParagraphs = s.contentParagraphs
  const variant = s.textVariant as string | null

  // contentParagraphs is a JSON field that should be string[]
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
    <View
      style={[
        layout.sectionOuter,
        styles.localContainer,
        isLead && styles.containerLead,
      ]}
    >
      {subtitle != null && (
        <Text
          style={[text.sectionSubtitle, styles.localSubtitle, typography.body]}
        >
          {subtitle}
        </Text>
      )}
      {heading != null && (
        <Text
          style={[text.sectionHeading, styles.localHeading, headingToken]}
          accessibilityRole="header"
        >
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
          <Text style={[text.accentLinkText, typography.bodySmall]}>
            {expanded ? "Show less" : "Read more"}
          </Text>
        </Pressable>
      )}
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  localContainer: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  containerLead: {
    paddingVertical: 24,
  },
  localHeading: {
    marginBottom: 8,
  },
  localSubtitle: {
    fontWeight: "500",
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
})

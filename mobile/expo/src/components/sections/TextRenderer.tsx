import { StyleSheet, Text, View } from "react-native"

import type { TextHeadingLevel, TextSection } from "../../lib/sectionModels"
import { useSectionColorScheme } from "./SectionColorSchemeContext"

export interface TextRendererProps {
  section: TextSection
}

const headingFontSizes: Record<TextHeadingLevel, number> = {
  h1: 32,
  h2: 28,
  h3: 24,
  h4: 20,
  h5: 18,
  h6: 16,
}

export function TextRenderer({ section }: TextRendererProps) {
  const { heading, headingLevel, subtitle, content, variant } = section
  const colorScheme = useSectionColorScheme()
  const isOnDark = colorScheme === "light"

  const isLead = variant === "lead"
  const isSmall = variant === "small"

  const headingSize = headingFontSizes[headingLevel ?? "h2"]

  return (
    // @ts-expect-error React 19 vs RN component types
    <View
      style={[
        styles.container,
        isLead && styles.containerLead,
        isSmall && styles.containerSmall,
      ]}
    >
      {heading != null && (
        // @ts-expect-error RN Text vs React 19 ReactNode
        <Text
          style={[
            styles.heading,
            { fontSize: headingSize },
            isOnDark && styles.headingLight,
          ]}
          accessibilityRole="header"
        >
          {heading}
        </Text>
      )}
      {subtitle != null && (
        // @ts-expect-error RN Text vs React 19 ReactNode
        <Text style={[styles.subtitle, isOnDark && styles.subtitleLight]}>
          {subtitle}
        </Text>
      )}
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text
        style={[
          styles.content,
          isLead && styles.contentLead,
          isSmall && styles.contentSmall,
          isOnDark && styles.contentLight,
        ]}
      >
        {content}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    marginVertical: 4,
  },
  containerLead: {
    paddingVertical: 32,
  },
  containerSmall: {
    padding: 16,
  },
  heading: {
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 8,
  },
  headingLight: {
    color: "#ffffff",
  },
  subtitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#666666",
    marginBottom: 12,
  },
  subtitleLight: {
    color: "rgba(255, 255, 255, 0.7)",
  },
  content: {
    fontSize: 16,
    color: "#333333",
    lineHeight: 24,
  },
  contentLight: {
    color: "rgba(255, 255, 255, 0.85)",
  },
  contentLead: {
    fontSize: 20,
    lineHeight: 30,
  },
  contentSmall: {
    fontSize: 14,
    lineHeight: 20,
  },
})

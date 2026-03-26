import { StyleSheet, Text, View } from "react-native"

import { useTypography } from "../../hooks/useTypography"
import type { TextSection } from "../../lib/sectionModels"
import { useSectionColorScheme } from "./SectionColorSchemeContext"

export interface TextRendererProps {
  section: TextSection
}

export function TextRenderer({ section }: TextRendererProps) {
  const { heading, headingLevel, subtitle, content, variant } = section
  const colorScheme = useSectionColorScheme()
  const isOnDark = colorScheme === "light"
  const typography = useTypography()

  const isLead = variant === "lead"
  const isSmall = variant === "small"

  // Default to h2 when CMS doesn't specify a heading level
  const headingToken = typography.headingScale[headingLevel ?? "h2"]
  const contentToken = typography.body

  return (
    <View
      style={[
        styles.container,
        isLead && styles.containerLead,
        isSmall && styles.containerSmall,
      ]}
    >
      {heading != null && (
        <Text
          style={[
            styles.heading,
            headingToken,
            isOnDark && styles.headingLight,
          ]}
          accessibilityRole="header"
        >
          {heading}
        </Text>
      )}
      {subtitle != null && (
        <Text
          style={[
            styles.subtitle,
            typography.body,
            isOnDark && styles.subtitleLight,
          ]}
        >
          {subtitle}
        </Text>
      )}
      <Text
        style={[styles.content, contentToken, isOnDark && styles.contentLight]}
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
    fontWeight: "500",
    color: "#666666",
    marginBottom: 12,
  },
  subtitleLight: {
    color: "rgba(255, 255, 255, 0.7)",
  },
  content: {
    color: "#333333",
  },
  contentLight: {
    color: "rgba(255, 255, 255, 0.85)",
  },
})

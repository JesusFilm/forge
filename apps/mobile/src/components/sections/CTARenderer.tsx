import { Pressable, StyleSheet, Text, View } from "react-native"

import { useTypography } from "../../hooks/useTypography"
import type { CTASection } from "../../lib/sectionModels"
import { useNavigateLink } from "../../lib/useNavigateLink"
import { useSectionColorScheme } from "./SectionColorSchemeContext"

export interface CTARendererProps {
  section: CTASection
}

export function CTARenderer({ section }: CTARendererProps) {
  const { heading, body, buttonLabel, buttonLink, variant } = section
  const colorScheme = useSectionColorScheme()
  const isOnDark = colorScheme === "light"
  const typography = useTypography()
  const isPrimary = variant !== "secondary"
  const isDisabled = buttonLink == null
  const onNavigate = useNavigateLink()

  const handlePress = () => {
    if (buttonLink == null) return
    onNavigate(buttonLink)
  }

  return (
    <View style={styles.container}>
      {heading != null && (
        <Text
          style={[
            styles.heading,
            typography.heading,
            isOnDark && styles.headingLight,
          ]}
          accessibilityRole="header"
        >
          {heading}
        </Text>
      )}
      {body != null && (
        <Text
          style={[styles.body, typography.body, isOnDark && styles.bodyLight]}
        >
          {body}
        </Text>
      )}
      <Pressable
        style={({ pressed }: { pressed: boolean }) => [
          styles.button,
          isPrimary ? styles.buttonPrimary : styles.buttonSecondary,
          pressed &&
            (isPrimary
              ? styles.buttonPrimaryPressed
              : styles.buttonSecondaryPressed),
          isDisabled && styles.buttonDisabled,
        ]}
        onPress={handlePress}
        disabled={isDisabled}
        accessibilityRole="link"
        accessibilityLabel={buttonLabel}
      >
        <Text
          style={[
            styles.buttonText,
            typography.body,
            isPrimary ? styles.buttonTextPrimary : styles.buttonTextSecondary,
          ]}
        >
          {buttonLabel}
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    marginVertical: 4,
    alignItems: "center",
  },
  heading: {
    fontWeight: "700",
    color: "#1a1a1a",
    textAlign: "center",
    marginBottom: 8,
  },
  headingLight: {
    color: "#ffffff",
  },
  body: {
    color: "#4a4a4a",
    textAlign: "center",
    marginBottom: 16,
  },
  bodyLight: {
    color: "rgba(255, 255, 255, 0.85)",
  },
  button: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 8,
    minWidth: 160,
    alignItems: "center",
  },
  buttonPrimary: {
    backgroundColor: "#1a73e8",
  },
  buttonPrimaryPressed: {
    backgroundColor: "#1558b0",
  },
  buttonSecondary: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#1a73e8",
  },
  buttonSecondaryPressed: {
    backgroundColor: "rgba(26, 115, 232, 0.08)",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontWeight: "600",
  },
  buttonTextPrimary: {
    color: "#ffffff",
  },
  buttonTextSecondary: {
    color: "#1a73e8",
  },
})

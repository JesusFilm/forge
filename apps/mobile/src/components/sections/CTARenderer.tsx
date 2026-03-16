import { Pressable, StyleSheet, Text, View } from "react-native"

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
          style={[styles.heading, isOnDark && styles.headingLight]}
          accessibilityRole="header"
        >
          {heading}
        </Text>
      )}
      {body != null && (
        <Text style={[styles.body, isOnDark && styles.bodyLight]}>{body}</Text>
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
    fontSize: 24,
    fontWeight: "700",
    color: "#1a1a1a",
    textAlign: "center",
    marginBottom: 8,
  },
  headingLight: {
    color: "#ffffff",
  },
  body: {
    fontSize: 16,
    color: "#4a4a4a",
    textAlign: "center",
    lineHeight: 24,
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
    fontSize: 16,
    fontWeight: "600",
  },
  buttonTextPrimary: {
    color: "#ffffff",
  },
  buttonTextSecondary: {
    color: "#1a73e8",
  },
})

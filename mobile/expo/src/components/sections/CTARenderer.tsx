import { Linking, Pressable, StyleSheet, Text, View } from "react-native"

import type { CTASection } from "../../lib/sectionModels"

export interface CTARendererProps {
  section: CTASection
}

export function CTARenderer({ section }: CTARendererProps) {
  const { heading, body, buttonLabel, buttonLink, variant } = section
  const isPrimary = variant !== "secondary"

  const handlePress = () => {
    if (buttonLink) {
      void Linking.openURL(buttonLink)
    }
  }

  return (
    // @ts-expect-error React 19 vs RN component types
    <View style={styles.container}>
      {heading != null && (
        // @ts-expect-error RN Text vs React 19 ReactNode
        <Text style={styles.heading} accessibilityRole="header">
          {heading}
        </Text>
      )}
      {body != null && (
        // @ts-expect-error RN Text vs React 19 ReactNode
        <Text style={styles.body}>{body}</Text>
      )}
      {/* @ts-expect-error React 19 vs RN component types */}
      <Pressable
        style={({ pressed }: { pressed: boolean }) => [
          styles.button,
          isPrimary ? styles.buttonPrimary : styles.buttonSecondary,
          pressed &&
            (isPrimary
              ? styles.buttonPrimaryPressed
              : styles.buttonSecondaryPressed),
        ]}
        onPress={handlePress}
        accessibilityRole="link"
        accessibilityLabel={buttonLabel}
      >
        {/* @ts-expect-error RN Text vs React 19 ReactNode */}
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
  body: {
    fontSize: 16,
    color: "#4a4a4a",
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 16,
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

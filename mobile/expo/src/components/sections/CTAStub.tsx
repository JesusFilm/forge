import { StyleSheet, Text, View } from "react-native"

import type { CTASection } from "../../lib/sectionModels"

export interface CTARendererProps {
  section: CTASection
}

export function CTARenderer({ section }: CTARendererProps) {
  return (
    // @ts-expect-error React 19 vs RN component types
    <View style={styles.container}>
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text style={styles.label}>CTA ({section.variant ?? "default"})</Text>
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text style={styles.detail}>
        {section.heading ?? section.buttonLabel}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    marginVertical: 4,
    backgroundColor: "#fff3e0",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ffcc80",
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: "#e65100",
    marginBottom: 4,
  },
  detail: {
    fontSize: 13,
    color: "#333",
  },
})

import { StyleSheet, Text, View } from "react-native"

import type { TextSection } from "../../lib/sectionModels"

export interface TextRendererProps {
  section: TextSection
}

export function TextRenderer({ section }: TextRendererProps) {
  return (
    // @ts-expect-error React 19 vs RN component types
    <View style={styles.container}>
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text style={styles.label}>Text ({section.variant ?? "default"})</Text>
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text style={styles.detail}>
        {section.heading ?? section.content.slice(0, 80)}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    marginVertical: 4,
    backgroundColor: "#f3e5f5",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ce93d8",
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: "#6a1b9a",
    marginBottom: 4,
  },
  detail: {
    fontSize: 13,
    color: "#333",
  },
})

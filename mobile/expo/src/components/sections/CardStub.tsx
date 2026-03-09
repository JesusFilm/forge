import { StyleSheet, Text, View } from "react-native"

import type { CardSection } from "../../lib/sectionModels"

export interface CardRendererProps {
  section: CardSection
}

export function CardRenderer({ section }: CardRendererProps) {
  return (
    // @ts-expect-error React 19 vs RN component types
    <View style={styles.container}>
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text style={styles.label}>Card ({section.variant ?? "default"})</Text>
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text style={styles.detail}>{section.title}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    marginVertical: 4,
    backgroundColor: "#efebe9",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#bcaaa4",
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: "#4e342e",
    marginBottom: 4,
  },
  detail: {
    fontSize: 13,
    color: "#333",
  },
})

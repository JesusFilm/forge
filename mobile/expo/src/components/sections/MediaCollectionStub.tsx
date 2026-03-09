import { StyleSheet, Text, View } from "react-native"

import type { MediaCollectionSection } from "../../lib/sectionModels"

export interface MediaCollectionRendererProps {
  section: MediaCollectionSection
}

export function MediaCollectionRenderer({
  section,
}: MediaCollectionRendererProps) {
  return (
    // @ts-expect-error React 19 vs RN component types
    <View style={styles.container}>
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text style={styles.label}>MediaCollection ({section.variant})</Text>
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text style={styles.detail}>
        {section.title ?? section.id} · {section.items.length} items
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    marginVertical: 4,
    backgroundColor: "#e3f2fd",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#90caf9",
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1565c0",
    marginBottom: 4,
  },
  detail: {
    fontSize: 13,
    color: "#333",
  },
})

import { StyleSheet, Text, View } from "react-native"

import type { VideoHeroSection } from "../../lib/sectionModels"

export interface VideoHeroRendererProps {
  section: VideoHeroSection
}

export function VideoHeroRenderer({ section }: VideoHeroRendererProps) {
  return (
    // @ts-expect-error React 19 vs RN component types
    <View style={styles.container}>
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text style={styles.label}>VideoHero</Text>
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text style={styles.detail}>{section.heading ?? section.id}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    marginVertical: 4,
    backgroundColor: "#e8f5e9",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#a5d6a7",
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: "#2e7d32",
    marginBottom: 4,
  },
  detail: {
    fontSize: 13,
    color: "#333",
  },
})

import { StyleSheet, Text, View } from "react-native"

import type { VideoSection } from "../../lib/sectionModels"

export interface VideoRendererProps {
  section: VideoSection
}

export function VideoRenderer({ section }: VideoRendererProps) {
  return (
    // @ts-expect-error React 19 vs RN component types
    <View style={styles.container}>
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text style={styles.label}>Video</Text>
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text style={styles.detail}>{section.title ?? section.id}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    marginVertical: 4,
    backgroundColor: "#fce4ec",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ef9a9a",
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: "#c62828",
    marginBottom: 4,
  },
  detail: {
    fontSize: 13,
    color: "#333",
  },
})

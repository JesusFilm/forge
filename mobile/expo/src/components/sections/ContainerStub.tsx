import { StyleSheet, Text, View } from "react-native"

import type { ContainerSection } from "../../lib/sectionModels"
import { ContentDispatcher } from "./SectionDispatcher"

export interface ContainerRendererProps {
  section: ContainerSection
}

export function ContainerRenderer({ section }: ContainerRendererProps) {
  return (
    // @ts-expect-error React 19 vs RN component types
    <View style={styles.container}>
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text style={styles.label}>Container · {section.slots.length} slots</Text>
      {section.slots.map((slot) => (
        // @ts-expect-error React 19 vs RN component types
        <View key={slot.id} style={styles.slot}>
          {/* @ts-expect-error RN Text vs React 19 ReactNode */}
          <Text style={styles.slotLabel}>Slot (span {slot.gridSpan})</Text>
          <ContentDispatcher content={slot.content} />
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    marginVertical: 4,
    backgroundColor: "#eceff1",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#90a4ae",
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: "#37474f",
    marginBottom: 4,
  },
  slot: {
    padding: 8,
    marginTop: 4,
    backgroundColor: "#fff",
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#cfd8dc",
  },
  slotLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#546e7a",
    marginBottom: 4,
  },
})

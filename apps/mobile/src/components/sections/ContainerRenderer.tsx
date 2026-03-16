import { StyleSheet, useWindowDimensions, View } from "react-native"

import type { ContainerSection } from "../../lib/sectionModels"
import { ContentDispatcher } from "./SectionDispatcher"

export interface ContainerRendererProps {
  section: ContainerSection
}

const STACK_BREAKPOINT = 500

export function ContainerRenderer({ section }: ContainerRendererProps) {
  const { width } = useWindowDimensions()
  const isStacked = width < STACK_BREAKPOINT
  const { slots } = section

  if (slots.length === 0) return null

  return (
    <View style={[styles.container, !isStacked && styles.row]}>
      {slots.map((slot) => (
        <View
          key={slot.id}
          style={[styles.slot, !isStacked && { flex: slot.gridSpan }]}
        >
          {slot.content.length > 0 && (
            <ContentDispatcher content={slot.content} />
          )}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
  },
  row: {
    flexDirection: "row",
  },
  slot: {
    minWidth: 0,
  },
})

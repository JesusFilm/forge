import { StyleSheet, View } from "react-native"

import type { NormalizedBlock } from "../../lib/normalizer"
import { SectionDispatcher } from "./SectionDispatcher"

type Slot = {
  id: string
  gridSpan: number
  slotContent?: NormalizedBlock[]
}

export interface ContainerRendererProps {
  section: NormalizedBlock
}

export function ContainerRenderer({ section }: ContainerRendererProps) {
  const slots = (section.slots as Slot[] | undefined) ?? []

  if (slots.length === 0) return null

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {slots.map((slot) => {
          const content = slot.slotContent ?? []
          return (
            <View
              key={`container-slot-${slot.id}`}
              style={[styles.slot, { flex: slot.gridSpan }]}
            >
              {content.map((child, index) => (
                <SectionDispatcher
                  key={`${child.kind}-${child.id}-${index}`}
                  section={child}
                />
              ))}
            </View>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 80,
    paddingVertical: 24,
  },
  row: {
    flexDirection: "row",
  },
  slot: {
    minWidth: 0,
  },
})

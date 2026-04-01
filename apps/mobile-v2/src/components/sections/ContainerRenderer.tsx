import { StyleSheet, useWindowDimensions, View } from "react-native"

import type { NormalizedBlock } from "../../lib/normalizer"
import { ContentDispatcher } from "./ContentDispatcher"

// ── Types ───────────────────────────────────────────────────────────────────

type Slot = {
  id: string
  gridSpan: number
  slotContent?: NormalizedBlock[]
}

export interface ContainerRendererProps {
  section: NormalizedBlock
}

// ── Constants ───────────────────────────────────────────────────────────────

const STACK_BREAKPOINT = 500

// ── Component ───────────────────────────────────────────────────────────────

export function ContainerRenderer({ section }: ContainerRendererProps) {
  const { width } = useWindowDimensions()
  const isStacked = width < STACK_BREAKPOINT
  const slots = (section.slots as Slot[] | undefined) ?? []

  if (slots.length === 0) return null

  return (
    <View style={[styles.container, !isStacked && styles.row]}>
      {slots.map((slot) => {
        const content = slot.slotContent ?? []
        return (
          <View
            key={`container-slot-${slot.id}`}
            style={[styles.slot, !isStacked && { flex: slot.gridSpan }]}
          >
            {content.length > 0 && <ContentDispatcher content={content} />}
          </View>
        )
      })}
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

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

import { StyleSheet, View } from "react-native"

import {
  blockKey,
  type ContainerBlockModel,
  type NormalizedSlot,
} from "../../lib/normalizer"
import { SectionDispatcher } from "./SectionDispatcher"

type Slot = NormalizedSlot

export interface ContainerRendererProps {
  section: ContainerBlockModel
}

type GridBreakpoint = "xs" | "sm" | "md" | "lg" | "xl"

function clampSpan(value: unknown, fallback = 6) {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(12, Math.max(1, Math.round(parsed)))
}

function tvSpan(slot: Slot) {
  const base = clampSpan(slot.gridSpan)
  const spans =
    slot.spans && typeof slot.spans === "object" && !Array.isArray(slot.spans)
      ? (slot.spans as Partial<Record<GridBreakpoint, unknown>>)
      : {}
  return clampSpan(spans.xl ?? spans.lg ?? spans.md, base)
}

export function ContainerRenderer({ section }: ContainerRendererProps) {
  const slots: Slot[] = section.slots ?? []

  if (slots.length === 0) return null

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {slots.map((slot, index) => {
          const content = slot.slotContent ?? []
          return (
            <View
              key={`container-slot-${index}`}
              style={[styles.slot, { flex: tvSpan(slot) }]}
            >
              {content.map((child, index) => (
                <SectionDispatcher
                  key={`${child.kind}-${blockKey(child) ?? "block"}-${index}`}
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

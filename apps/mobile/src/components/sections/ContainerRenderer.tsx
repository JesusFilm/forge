import { StyleSheet, useWindowDimensions, View } from "react-native"

import { layout } from "../../styles/shared"
import type { NormalizedBlock } from "../../lib/normalizer"

// Lazy import to break require cycle: ContentDispatcher -> ContainerRenderer -> ContentDispatcher
let _ContentDispatcher: typeof import("./ContentDispatcher").ContentDispatcher
function getContentDispatcher() {
  if (!_ContentDispatcher) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _ContentDispatcher = require("./ContentDispatcher").ContentDispatcher
  }
  return _ContentDispatcher
}

// ── Types ───────────────────────────────────────────────────────────────────

type Slot = {
  id: string
  gridSpan: number
  spans?: unknown
  slotContent?: NormalizedBlock[]
}

export interface ContainerRendererProps {
  section: NormalizedBlock
}

// ── Constants ───────────────────────────────────────────────────────────────

type GridBreakpoint = "xs" | "sm" | "md" | "lg" | "xl"

function breakpointForWidth(width: number): GridBreakpoint {
  if (width < 640) return "xs"
  if (width < 768) return "sm"
  if (width < 1024) return "md"
  if (width < 1280) return "lg"
  return "xl"
}

function clampSpan(value: unknown, fallback = 6) {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(12, Math.max(1, Math.round(parsed)))
}

function spanForSlot(slot: Slot, breakpoint: GridBreakpoint) {
  const base = clampSpan(slot.gridSpan)
  const spans =
    slot.spans && typeof slot.spans === "object" && !Array.isArray(slot.spans)
      ? (slot.spans as Partial<Record<GridBreakpoint, unknown>>)
      : {}
  const fallback = breakpoint === "xs" || breakpoint === "sm" ? 12 : base
  return clampSpan(spans[breakpoint], fallback)
}

// ── Component ───────────────────────────────────────────────────────────────

export function ContainerRenderer({ section }: ContainerRendererProps) {
  const { width } = useWindowDimensions()
  const breakpoint = breakpointForWidth(width)
  const slots = (section.slots as Slot[] | undefined) ?? []

  if (slots.length === 0) return null

  return (
    <View style={[layout.sectionOuter, styles.row]}>
      {slots.map((slot) => {
        const content = slot.slotContent ?? []
        const span = spanForSlot(slot, breakpoint)
        return (
          <View
            key={`container-slot-${slot.id}`}
            style={[styles.slot, { width: `${(span / 12) * 100}%` }]}
          >
            {content.length > 0 &&
              (() => {
                const Dispatcher = getContentDispatcher()
                return <Dispatcher content={content} />
              })()}
          </View>
        )
      })}
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  slot: {
    minWidth: 0,
  },
})

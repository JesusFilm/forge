import { useMemo } from "react"
import { StyleSheet, useWindowDimensions, View } from "react-native"

import { layout } from "../../styles/shared"
import type { AdminBlock } from "../../lib/queries"

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

type SlotGroup = {
  gridSpan: number
  spans: Record<string, unknown>
  items: AdminBlock[]
}

export interface ContainerRendererProps {
  section: AdminBlock
}

// ── Slot grouping ──────────────────────────────────────────────────────────

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

function spanForGroup(group: SlotGroup, breakpoint: GridBreakpoint) {
  const base = clampSpan(group.gridSpan)
  const fallback = breakpoint === "xs" || breakpoint === "sm" ? 12 : base
  return clampSpan(group.spans[breakpoint], fallback)
}

function groupBySlotMarker(content: AdminBlock[]): SlotGroup[] {
  const groups: SlotGroup[] = []
  let current: SlotGroup | null = null
  let droppedOrphans = 0

  for (const item of content) {
    if (item.__typename === "ContainerSlotBlock") {
      const raw = item as Record<string, unknown>
      current = {
        gridSpan: clampSpan(raw.gridSpan),
        spans:
          raw.spans &&
          typeof raw.spans === "object" &&
          !Array.isArray(raw.spans)
            ? (raw.spans as Record<string, unknown>)
            : {},
        items: [],
      }
      groups.push(current)
    } else if (current) {
      current.items.push(item)
    } else {
      droppedOrphans++
    }
  }

  if (__DEV__ && droppedOrphans > 0) {
    console.warn(
      `[ContainerRenderer] groupBySlotMarker dropped ${droppedOrphans} item(s) before first slot marker`,
    )
  }

  return groups.filter((g) => g.items.length > 0)
}

// ── Component ───────────────────────────────────────────────────────────────

export function ContainerRenderer({ section }: ContainerRendererProps) {
  const { width } = useWindowDimensions()
  const breakpoint = breakpointForWidth(width)

  const s = section as Record<string, unknown>
  const content = (s.content as AdminBlock[] | undefined) ?? []

  const groups = useMemo(() => groupBySlotMarker(content), [content])

  if (groups.length === 0) return null

  return (
    <View style={[layout.sectionOuter, styles.row]}>
      {groups.map((group, index) => {
        const span = spanForGroup(group, breakpoint)
        const Dispatcher = getContentDispatcher()
        return (
          <View
            key={`container-slot-${index}`}
            style={[styles.slot, { width: `${(span / 12) * 100}%` }]}
          >
            <Dispatcher content={group.items} />
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

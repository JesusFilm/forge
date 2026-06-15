// Pure rail-item builder for HomeRail, extracted so the over-hang pad math is
// unit-testable (jest-expo can't load .tsx — same reason homeScrollState.ts /
// homeCardRouting.ts are split out).

import type { WatchHomeCard } from "../../lib/watchHome/model"

// A rail item is either a real card or a trailing invisible pad (over-hang
// catcher). Pads share the card's column footprint so getItemLayout stays
// uniform and columns line up across rails.
export type RailItem = { kind: "card"; card: WatchHomeCard } | { kind: "pad" }

/**
 * Real cards, then invisible pads filling the rail out to `visibleColumns`, so
 * an over-hanging vertical D-pad move always finds a focusable cell here (a
 * shorter rail is otherwise SKIPPED by the tvOS focus engine). A rail already
 * at/over the column count gets no pads. An empty rail gets nothing — pads
 * with no real card to bounce to are pointless (and HomeRail renders null for
 * an empty rail anyway).
 */
export function buildRailItems(
  cards: WatchHomeCard[],
  visibleColumns: number,
): RailItem[] {
  if (cards.length === 0) return []
  const items: RailItem[] = cards.map((card) => ({ kind: "card", card }))
  const padCount = Math.max(0, visibleColumns - cards.length)
  for (let i = 0; i < padCount; i++) items.push({ kind: "pad" })
  return items
}

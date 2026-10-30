/**
 * Home's feed composition, extracted from the screen so the recommendations
 * gate and the shelf's authored position are decided by pure functions
 * (feat-517 KTD9). A closed gate leaves no feed item at all, so there is no
 * placeholder to collapse and no controller to enable.
 */
import type { WatchHomeModel, WatchHomeSection } from "./model"

export type HomeFeedItem =
  | { kind: "selector" }
  | { kind: "section"; section: WatchHomeSection }
  | { kind: "recommendations" }
  | { kind: "mission" }

export type RecommendationsGateInput = {
  /**
   * The block's authored position among the Experience shelves. Null covers
   * BOTH closed server-side axes: the block is unpublished, or the Home body
   * fell back to the config model (KD9). `useWatchHome` reports it that way.
   */
  insertIndex: number | null
  /** `isRecommendationClientEnabled()` — the opt-out kill switch (R2, AE9). */
  clientEnabled: boolean
  /** A fleet bearer is configured; without one nothing can be requested. */
  hasBearer: boolean
}

/** Every axis must hold. One false answer removes the shelf entirely. */
export function recommendationsShelfVisible(
  gate: RecommendationsGateInput,
): boolean {
  return gate.insertIndex != null && gate.clientEnabled && gate.hasBearer
}

export type HomeFeedInput = {
  model: WatchHomeModel | null
  /** Multi-slide hero queues get a selector rail; single-slide queues do not. */
  showSelector: boolean
  recommendations: RecommendationsGateInput
}

/** Where the shelf sits among the sections, or null when the gate is closed. */
function shelfPosition(
  input: HomeFeedInput,
  sectionCount: number,
): number | null {
  if (!recommendationsShelfVisible(input.recommendations)) return null
  const authored = input.recommendations.insertIndex ?? 0
  // Clamp rather than drop: an index outside the section range still names a
  // published block, and a silently missing shelf reads as a delivery fault.
  return Math.min(Math.max(authored, 0), sectionCount)
}

export function buildHomeFeed(input: HomeFeedInput): HomeFeedItem[] {
  const model = input.model
  if (model == null) return []
  const items: HomeFeedItem[] = []
  if (input.showSelector) items.push({ kind: "selector" })
  const position = shelfPosition(input, model.sections.length)
  for (const [index, section] of model.sections.entries()) {
    if (index === position) items.push({ kind: "recommendations" })
    items.push({ kind: "section", section })
  }
  if (position === model.sections.length)
    items.push({ kind: "recommendations" })
  items.push({ kind: "mission" })
  return items
}

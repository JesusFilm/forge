// Hardcoded Discover empty-state categories, mirroring web's search overlay
// (apps/web/src/lib/search-categories.ts). `searchTerm` (not the label) drives
// admin search; the card shows `labelKey` from the `BrowseTopics` catalog.

import type { UiMessageKey } from "../i18n/useT"

export type BrowseTopic = {
  readonly labelKey: UiMessageKey<"BrowseTopics">
  readonly searchTerm: string
  readonly gradient: readonly [string, string]
  readonly glyph: string
}

export const BROWSE_TOPICS: readonly BrowseTopic[] = [
  {
    labelKey: "bibleStories",
    searchTerm: "bible stories",
    gradient: ["#667EEA", "#764BA2"],
    glyph: "book-outline",
  },
  {
    labelKey: "parables",
    searchTerm: "parables",
    gradient: ["#F093FB", "#F5576C"],
    glyph: "chatbubbles-outline",
  },
  {
    labelKey: "animated",
    searchTerm: "animated",
    gradient: ["#4FACFE", "#00C2D6"],
    glyph: "film-outline",
  },
  {
    labelKey: "study",
    searchTerm: "study",
    gradient: ["#0BAB64", "#3BB78F"],
    glyph: "bulb-outline",
  },
  {
    labelKey: "family",
    searchTerm: "family",
    gradient: ["#A45EDB", "#FA709A"],
    glyph: "people-outline",
  },
  {
    labelKey: "christmas",
    searchTerm: "christmas",
    gradient: ["#DC2626", "#7F1D1D"],
    glyph: "star-outline",
  },
] as const

const TOPIC_TERMS: ReadonlySet<string> = new Set(
  BROWSE_TOPICS.map((topic) => topic.searchTerm),
)

/** A topic's own search term. Its words are English in every UI (U7). */
export function isBrowseTopicTerm(query: string): boolean {
  return TOPIC_TERMS.has(query.trim().toLowerCase())
}

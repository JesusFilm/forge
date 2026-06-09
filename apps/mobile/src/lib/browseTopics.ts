// Six hardcoded browse categories for the Discover empty state, mirroring the
// web search overlay's categories (apps/web/src/lib/search-categories.ts). The
// `searchTerm` — not the label — is fed into the existing admin search. Each
// topic carries a two-stop `gradient` (the web category palette) used as the
// card fill, and a `glyph` (an Ionicons name) shown top-left.

export type BrowseTopic = {
  readonly label: string
  readonly searchTerm: string
  readonly gradient: readonly [string, string]
  readonly glyph: string
}

export const BROWSE_TOPICS: readonly BrowseTopic[] = [
  {
    label: "Bible Stories",
    searchTerm: "bible stories",
    gradient: ["#667EEA", "#764BA2"],
    glyph: "book-outline",
  },
  {
    label: "Parables",
    searchTerm: "parables",
    gradient: ["#F093FB", "#F5576C"],
    glyph: "chatbubbles-outline",
  },
  {
    label: "Animated",
    searchTerm: "animated",
    gradient: ["#4FACFE", "#00C2D6"],
    glyph: "film-outline",
  },
  {
    label: "Study",
    searchTerm: "study",
    gradient: ["#0BAB64", "#3BB78F"],
    glyph: "bulb-outline",
  },
  {
    label: "Family",
    searchTerm: "family",
    gradient: ["#A45EDB", "#FA709A"],
    glyph: "people-outline",
  },
  {
    label: "Christmas",
    searchTerm: "christmas",
    gradient: ["#DC2626", "#7F1D1D"],
    glyph: "star-outline",
  },
] as const

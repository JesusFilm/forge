// Six hardcoded browse topics for the Discover empty state, mirroring the web
// search overlay's categories (apps/web/src/lib/search-categories.ts). The
// `searchTerm` — not the label — is fed into the existing admin search. Per-topic
// `baseColor` and `glyph` are net-new mobile design tokens: the color seeds the
// soft gradient fill + glyph tint, the glyph is an Ionicons name.

export type BrowseTopic = {
  readonly label: string
  readonly searchTerm: string
  readonly baseColor: string
  readonly glyph: string
}

export const BROWSE_TOPICS: readonly BrowseTopic[] = [
  {
    label: "Bible Stories",
    searchTerm: "bible stories",
    baseColor: "#667EEA",
    glyph: "book-outline",
  },
  {
    label: "Parables",
    searchTerm: "parables",
    baseColor: "#F5576C",
    glyph: "chatbubbles-outline",
  },
  {
    label: "Animated",
    searchTerm: "animated",
    baseColor: "#4FACFE",
    glyph: "film-outline",
  },
  {
    label: "Study",
    searchTerm: "study",
    baseColor: "#43E97B",
    glyph: "bulb-outline",
  },
  {
    label: "Family",
    searchTerm: "family",
    baseColor: "#FA709A",
    glyph: "people-outline",
  },
  {
    label: "Christmas",
    searchTerm: "christmas",
    baseColor: "#DC2626",
    glyph: "star-outline",
  },
] as const

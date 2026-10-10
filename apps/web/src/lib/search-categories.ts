/**
 * Hardcoded category cards surfaced in the browse modal when no query is
 * active. Ported verbatim from watch-modern (apps/watch's SearchComponent).
 *
 * This module is intentionally free of React, Next, and Apollo imports so the
 * Node-executed pre-ship verification script (apps/web/scripts/verify-categories.ts)
 * can import it cleanly without dragging client-only modules through the graph.
 */

export type SearchCategory = {
  title: string
  searchTerm: string
  gradient: string
}

export const CATEGORIES = [
  {
    title: "Bible Stories",
    searchTerm: "bible stories",
    gradient: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  },
  {
    title: "Parables",
    searchTerm: "parables",
    gradient: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
  },
  {
    title: "Animated",
    searchTerm: "animated",
    gradient: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
  },
  {
    title: "Study",
    searchTerm: "study",
    gradient: "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
  },
  {
    title: "Family",
    searchTerm: "family",
    gradient: "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
  },
  {
    title: "Christmas",
    searchTerm: "christmas",
    gradient: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)",
  },
] as const satisfies readonly SearchCategory[]

// `searchTerm` is the stable structural identifier used for React keys,
// icons, and test ids. Localized display text is submitted as the query.
export type CategorySearchTerm = (typeof CATEGORIES)[number]["searchTerm"]

/**
 * Empty-query category cards for SearchBrowse. Titles/searchTerms ported verbatim
 * from apps/web/src/lib/search-categories.ts — keep in sync. RN can't parse CSS
 * gradients, so colors are 2-stop arrays; hex must match the web gradient stops.
 */

export type SearchCategory = {
  title: string
  searchTerm: string
  colors: readonly [string, string]
}

export const CATEGORIES = [
  {
    title: "Bible Stories",
    searchTerm: "bible stories",
    colors: ["#667eea", "#764ba2"] as const,
  },
  {
    title: "Parables",
    searchTerm: "parables",
    colors: ["#f093fb", "#f5576c"] as const,
  },
  {
    title: "Animated",
    searchTerm: "animated",
    colors: ["#4facfe", "#00f2fe"] as const,
  },
  {
    title: "Study",
    searchTerm: "study",
    colors: ["#43e97b", "#38f9d7"] as const,
  },
  {
    title: "Family",
    searchTerm: "family",
    colors: ["#fa709a", "#fee140"] as const,
  },
  {
    title: "Christmas",
    searchTerm: "christmas",
    colors: ["#dc2626", "#991b1b"] as const,
  },
] as const satisfies readonly SearchCategory[]

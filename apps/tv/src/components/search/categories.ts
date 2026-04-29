/**
 * Hardcoded category cards surfaced in SearchBrowse when the query is
 * empty. Titles and searchTerms are ported verbatim from
 * apps/web/src/lib/search-categories.ts — keeping the two lists in
 * sync preserves the brand moment across surfaces.
 *
 * RN cannot parse CSS linear-gradient strings, so the TV variant
 * expresses each card as a 2-color stop array + a 135° diagonal
 * angle. The actual render uses expo-linear-gradient in
 * SearchBrowse.tsx. The hex values here must match the web gradient
 * stops exactly; a follow-up ticket could extract a shared token
 * module once the TV app has proven its layout out.
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

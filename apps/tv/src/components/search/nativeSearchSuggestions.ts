import type { SearchState } from "../../lib/search"
import { CATEGORIES } from "./categories"
import type { NativeSearchResult } from "./nativeSearchResults"

export type NativeSearchSuggestion = {
  card: NativeSearchResult
  query: string
}

/** Reuse existing history/topics without fetching content before a search. */
export function nativeSearchSuggestions(
  recents: readonly string[],
  generation: number,
): NativeSearchSuggestion[] {
  const recentQueries = [
    ...new Set(recents.filter((query) => query.trim())),
  ].slice(0, 5)
  const recentTerms = new Set(
    recentQueries.map((query) => query.trim().toLowerCase()),
  )
  return [
    ...recentQueries.map((query, index) => ({
      // IDs cross the native event bridge: never include user-entered text.
      card: {
        id: `search-action:recent:${generation}:${index}`,
        title: query,
        subtitle: "Recent search",
      },
      query,
    })),
    ...CATEGORIES.map((category, index) => ({
      card: {
        id: `search-action:topic:${index}`,
        title: category.title,
        subtitle: "Browse topic",
      },
      query: category.searchTerm,
    })).filter(({ query }) => !recentTerms.has(query.trim().toLowerCase())),
  ]
}

export type NativeSearchAction =
  | { kind: "search"; card: NativeSearchResult; query: string }
  | { kind: "retry"; card: NativeSearchResult }

/** Errors are recoverable actions, distinct from a successful empty search. */
export function nativeSearchActions(
  state: SearchState,
  showSuggestions: boolean,
  suggestions: readonly NativeSearchSuggestion[],
): NativeSearchAction[] {
  if (showSuggestions) {
    return suggestions.map((suggestion) => ({ kind: "search", ...suggestion }))
  }
  if (state === "error") {
    return [
      {
        kind: "retry",
        card: {
          id: "search-action:retry",
          title: "Try again",
          subtitle: "Search unavailable",
        },
      },
    ]
  }
  return []
}

/** Resolve only displayed actions; stale/unknown bridge IDs do nothing. */
export function findNativeSearchAction(
  actions: readonly NativeSearchAction[],
  id: string,
): NativeSearchAction | null {
  return actions.find((action) => action.card.id === id) ?? null
}

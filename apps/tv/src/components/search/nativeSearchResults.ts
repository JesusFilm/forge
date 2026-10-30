// Maps app SearchResults into expo-tvos-search's native card shape. Pure module
// (not inline in search.tsx) so the projection is unit-testable without the
// screen's React/JSX module graph under jest-expo — same split as searchResultPath.

import { type SearchResult } from "../../lib/queries"
import { resultKindLabel } from "./searchDisplay"

/** The native view's card contract (expo-tvos-search `SearchResult`). */
export type NativeSearchResult = {
  id: string
  title: string
  subtitle?: string
  imageUrl?: string
}

/**
 * Project app results onto native cards using the same readable content kind as
 * the React renderer. Missing artwork stays absent: the native layer validates
 * imageUrl as a URL and would surface onError noise for a null-ish string.
 */
export function toNativeSearchResults(
  results: readonly SearchResult[],
): NativeSearchResult[] {
  return results.map((result) => ({
    id: result.id,
    title: result.title,
    subtitle: resultKindLabel(result),
    imageUrl: result.imageUrl ?? undefined,
  }))
}

/**
 * Resolve the native view's selection callback (an id, nothing else) back to
 * the full app result so routing reuses searchResultPath unchanged. Returns
 * null for an unknown id — e.g. a selection racing a results refresh.
 */
export function findResultById(
  results: readonly SearchResult[],
  id: string,
): SearchResult | null {
  return results.find((result) => result.id === id) ?? null
}

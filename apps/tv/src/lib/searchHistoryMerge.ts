/** Maximum recent queries retained on device. */
export const SEARCH_HISTORY_MAX = 5

/** Maximum per-entry length retained in history. Aligned with
 *  `sanitizeQuery`'s 256-char cap so longer strings can never land here. */
export const SEARCH_HISTORY_ENTRY_MAX_LENGTH = 256

/**
 * Deduplicate-to-front merge. Returns a new array where `query` sits
 * at index 0 and any prior occurrence (case-insensitive) is removed.
 * Result is capped at SEARCH_HISTORY_MAX entries.
 *
 * Kept in its own module (no React / AsyncStorage imports) so unit
 * tests can load the pure merge policy under the jest-expo preset
 * without pulling React Native native modules through babel.
 */
export function mergeRecent(prev: readonly string[], query: string): string[] {
  const lowered = query.toLowerCase()
  const filtered = prev.filter((existing) => existing.toLowerCase() !== lowered)
  return [query, ...filtered].slice(0, SEARCH_HISTORY_MAX)
}

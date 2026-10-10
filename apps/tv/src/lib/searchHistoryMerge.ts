/** Maximum recent queries retained on device. */
export const SEARCH_HISTORY_MAX = 5

/** Maximum per-entry length retained in history. Aligned with
 *  `sanitizeQuery`'s 256-char cap so longer strings can never land here. */
export const SEARCH_HISTORY_ENTRY_MAX_LENGTH = 256

/**
 * Deduplicate-to-front merge: `query` at index 0, prior occurrence (case-
 * insensitive) removed, capped at SEARCH_HISTORY_MAX. Own module (no React /
 * AsyncStorage) so jest-expo can load the pure policy without native modules.
 */
export function mergeRecent(prev: readonly string[], query: string): string[] {
  const lowered = query.toLowerCase()
  const filtered = prev.filter((existing) => existing.toLowerCase() !== lowered)
  return [query, ...filtered].slice(0, SEARCH_HISTORY_MAX)
}

import { useCallback, useEffect, useRef, useState } from "react"

import { getStorage } from "./safeStorage"
import {
  SEARCH_HISTORY_ENTRY_MAX_LENGTH,
  SEARCH_HISTORY_MAX,
  mergeRecent,
} from "./searchHistoryMerge"

export {
  SEARCH_HISTORY_ENTRY_MAX_LENGTH,
  SEARCH_HISTORY_MAX,
  mergeRecent,
} from "./searchHistoryMerge"

/** Versioned storage key so a future schema change (timestamps, locale,
 *  source-tagging) is a migration, not a breaking read. */
export const SEARCH_HISTORY_STORAGE_KEY = "tv.searchHistory.v1"

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string")
}

async function loadStoredHistory(): Promise<string[]> {
  try {
    const raw = await getStorage().getItem(SEARCH_HISTORY_STORAGE_KEY)
    if (raw == null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!isStringArray(parsed)) return []
    // Defensive cap + per-entry length clamp in case an older write
    // used a different policy.
    return parsed
      .slice(0, SEARCH_HISTORY_MAX)
      .map((q) => q.slice(0, SEARCH_HISTORY_ENTRY_MAX_LENGTH))
  } catch {
    return []
  }
}

type UseSearchHistoryResult = {
  recents: string[]
  /**
   * Add a query to recent history. No-op for empty/whitespace input;
   * dedupes case-insensitively and moves the query to the front.
   */
  addRecent: (query: string) => void
  /** Clear all recent-search entries (bound to the "Clear" chip). */
  clearAll: () => void
}

/**
 * AsyncStorage-backed recent-searches hook: hydrates on mount, writes on
 * every mutation. Accepts any non-empty query; callers decide what counts
 * as "successful" (this hook doesn't observe search state itself).
 */
export function useSearchHistory(): UseSearchHistoryResult {
  const [recents, setRecents] = useState<string[]>([])
  const mountedRef = useRef(true)

  useEffect(() => {
    void (async () => {
      const loaded = await loadStoredHistory()
      if (!mountedRef.current) return
      // Race: a fast addRecent before hydration resolves has already
      // overwritten disk with its single-entry list. Merge in-memory (newer
      // intent) onto on-disk (prior history) via addRecent's reducer, then re-persist.
      setRecents((prev) => {
        if (prev.length === 0) return loaded
        const merged = prev.reduceRight<string[]>(
          (acc, q) => mergeRecent(acc, q),
          loaded,
        )
        // Re-persist so disk reflects the merge instead of the
        // truncated single-entry list addRecent already wrote.
        void getStorage()
          .setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(merged))
          .catch(() => {
            /* see persist() below for swallow rationale */
          })
        return merged
      })
    })()

    return () => {
      mountedRef.current = false
    }
  }, [])

  const persist = useCallback((next: string[]) => {
    void getStorage()
      .setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(next))
      .catch(() => {
        // Best-effort: in-memory state already reflects the new value,
        // a write failure only means the next mount starts with the
        // previous on-disk state. Not worth surfacing to the user.
      })
  }, [])

  const addRecent = useCallback(
    (query: string) => {
      const trimmed = query.trim()
      if (trimmed.length === 0) return
      const capped = trimmed.slice(0, SEARCH_HISTORY_ENTRY_MAX_LENGTH)
      setRecents((prev) => {
        const next = mergeRecent(prev, capped)
        persist(next)
        return next
      })
    },
    [persist],
  )

  const clearAll = useCallback(() => {
    setRecents([])
    void getStorage()
      .removeItem(SEARCH_HISTORY_STORAGE_KEY)
      .catch(() => {
        // See persist() for rationale on swallowing errors.
      })
  }, [])

  return { recents, addRecent, clearAll }
}

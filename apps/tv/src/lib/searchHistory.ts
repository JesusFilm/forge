import AsyncStorage from "@react-native-async-storage/async-storage"
import { useCallback, useEffect, useRef, useState } from "react"

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
    const raw = await AsyncStorage.getItem(SEARCH_HISTORY_STORAGE_KEY)
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
   * Add a successful query to recent history. No-op for empty or
   * whitespace-only inputs. Deduplicates case-insensitively and moves
   * the query to the front. Returns the updated list so callers can
   * chain without awaiting the hook's next render.
   */
  addRecent: (query: string) => void
  /** Clear all recent-search entries (bound to the "Clear" chip). */
  clearAll: () => void
}

/**
 * AsyncStorage-backed recent-searches hook. Hydrates on mount, writes
 * on every mutation. Per doc-review, entries are added only after a
 * successful non-empty results submit (callers decide the "successful"
 * predicate); this hook accepts any non-empty query and does not
 * observe search state itself.
 */
export function useSearchHistory(): UseSearchHistoryResult {
  const [recents, setRecents] = useState<string[]>([])
  const hydratedRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    void (async () => {
      const loaded = await loadStoredHistory()
      if (!mountedRef.current) return
      setRecents(loaded)
      hydratedRef.current = true
    })()

    return () => {
      mountedRef.current = false
    }
  }, [])

  const persist = useCallback((next: string[]) => {
    void AsyncStorage.setItem(
      SEARCH_HISTORY_STORAGE_KEY,
      JSON.stringify(next),
    ).catch(() => {
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
    void AsyncStorage.removeItem(SEARCH_HISTORY_STORAGE_KEY).catch(() => {
      // See persist() for rationale on swallowing errors.
    })
  }, [])

  return { recents, addRecent, clearAll }
}

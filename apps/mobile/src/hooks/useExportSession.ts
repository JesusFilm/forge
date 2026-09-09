import { useSyncExternalStore } from "react"

import {
  getExportSessionStore,
  type ExportSessionEntry,
  type ExportSessionSnapshot,
} from "../lib/exportSession"

/**
 * Subscribe a surface to the raw-export session (KTD5). The store is module
 * scope rather than context because the launch sweep and the adapter read it
 * without React, so a provider could not reach every caller.
 */
export function useExportSession(): ExportSessionSnapshot {
  const store = getExportSessionStore()
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

/**
 * One video's export while one runs (R16). Null is the common case, so callers
 * pass it straight through to the indicator resolvers.
 */
export function useExportEntry(
  videoSlug: string | null | undefined,
): ExportSessionEntry | null {
  const session = useExportSession()
  if (!videoSlug) return null
  return session.byTarget[videoSlug] ?? null
}

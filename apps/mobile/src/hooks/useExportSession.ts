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
  const store = getExportSessionStore()
  // Per-target, NOT the whole snapshot: progress lands about once a second per
  // export, and the store keeps an untouched target's entry reference, so this
  // bails on every tick that belongs to another video.
  return useSyncExternalStore(store.subscribe, () =>
    videoSlug ? (store.getSnapshot().byTarget[videoSlug] ?? null) : null,
  )
}

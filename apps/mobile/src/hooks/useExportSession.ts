import { useSyncExternalStore } from "react"

import {
  getExportSessionStore,
  type ExportSessionEntry,
  type ExportSessionSnapshot,
} from "../lib/exportSession"
import {
  getSeriesExportProgressSnapshot,
  subscribeToSeriesExportProgress,
  type SeriesExportRunProgress,
} from "../lib/seriesExportProgress"

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

/**
 * How far a series' export run has got, in episodes saved. Per series, NOT the
 * whole snapshot: a run over another series would otherwise re-render this one
 * on every episode.
 */
export function useSeriesExportProgress(
  seriesSlug: string | null | undefined,
): SeriesExportRunProgress | null {
  return useSyncExternalStore(subscribeToSeriesExportProgress, () =>
    seriesSlug ? (getSeriesExportProgressSnapshot()[seriesSlug] ?? null) : null,
  )
}

/**
 * The viewer's controls over one running export. Plain functions, not hooks —
 * they read the module-scope store, so a tap handler can call them directly and
 * they never need to be dependencies. Each answers false when no run is there.
 *
 * The store, not the caller, owns the ordering that makes a pause safe: it sets
 * `paused` BEFORE the transfer is asked to suspend, because the native engine
 * reports a pause as a cancellation.
 */
export const exportControls = {
  pause: (videoSlug: string): boolean =>
    getExportSessionStore().requestPause(videoSlug),
  resume: (videoSlug: string): boolean =>
    getExportSessionStore().requestResume(videoSlug),
  stop: (videoSlug: string): boolean =>
    getExportSessionStore().requestCancel(videoSlug),
}

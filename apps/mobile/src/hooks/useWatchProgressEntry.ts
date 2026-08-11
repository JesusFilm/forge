import { useSyncExternalStore } from "react"

import {
  getProgressEntry,
  subscribeToProgress,
  type WatchProgressEntry,
} from "../lib/watchProgress/store"

/**
 * Subscribe one surface to one video's progress entry (KTD8). Undefined
 * when signed out or unwatched — bars render nothing (R10).
 */
export function useWatchProgressEntry(
  videoId: string | null | undefined,
): WatchProgressEntry | undefined {
  return useSyncExternalStore(subscribeToProgress, () =>
    videoId ? getProgressEntry(videoId) : undefined,
  )
}

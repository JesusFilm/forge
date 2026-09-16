/**
 * The last-watched record store (KTD5): a plain module the reminder scheduler
 * and the playback subscriber both read without a React dependency.
 *
 * Memory is authoritative. A write sets memory and persists at once, and
 * hydration applies the stored record only when memory is still empty, so a
 * slow read can never overwrite a video the viewer just started.
 */

import AsyncStorage from "@react-native-async-storage/async-storage"

import { withTimeout } from "../withTimeout"
import {
  LAST_WATCHED_STORAGE_KEY,
  parseStoredLastWatched,
  serializeLastWatched,
  type LastWatchedRecord,
} from "./snapshot"

/** The reminder pass awaits hydration, so a hung read must not hold it. */
export const LAST_WATCHED_HYDRATE_TIMEOUT_MS = 400

export type LastWatchedStoreDeps = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
  now: () => Date
}

export type LastWatchedStore = ReturnType<typeof createLastWatchedStore>

/** A storage seam that throws synchronously must not break its caller: the
 *  writer runs inside the playback store's notify loop. */
function persistQuietly(operation: () => Promise<unknown>) {
  try {
    void operation().catch(() => {})
  } catch {
    // Storage is best-effort; memory already holds the authoritative record.
  }
}

export function createLastWatchedStore(deps: LastWatchedStoreDeps) {
  let record: LastWatchedRecord | null = null
  let hydration: Promise<void> | null = null
  const clearListeners = new Set<() => void>()
  /**
   * A clear empties memory, so a hydration in flight can no longer tell "still
   * empty" from "emptied while I was reading". The epoch tells it apart.
   */
  let clearEpoch = 0

  return {
    getRecord(): LastWatchedRecord | null {
      return record
    },

    /**
     * Bounded read, memoized. It never rejects: a failed read leaves the
     * record absent, which the reminders read as Home (R13).
     */
    hydrate(): Promise<void> {
      if (hydration != null) return hydration
      const epochAtStart = clearEpoch
      hydration = (async () => {
        let raw: string | null = null
        try {
          raw = await withTimeout(
            deps.getItem(LAST_WATCHED_STORAGE_KEY),
            LAST_WATCHED_HYDRATE_TIMEOUT_MS,
          )
        } catch {
          // Only the cold-launch pass is on a deadline. Memoizing a timeout
          // would send every later reminder to Home while a real record sat
          // on disk, so a FAILED read clears the memo and a later pass retries.
          hydration = null
          return
        }
        if (clearEpoch !== epochAtStart) return
        if (record != null) return
        record = parseStoredLastWatched(raw, deps.now())
      })()
      return hydration
    },

    write(videoSlug: string): void {
      const next: LastWatchedRecord = {
        videoSlug,
        recordedAt: deps.now().getTime(),
      }
      const blob = serializeLastWatched(next)
      if (blob == null) return
      record = next
      persistQuietly(() => deps.setItem(LAST_WATCHED_STORAGE_KEY, blob))
    },

    /** R11/R18: empties memory now, drops the stored key, and tells the
     *  scheduler so the pending reminders stop naming the old video. */
    clear(): void {
      record = null
      clearEpoch += 1
      persistQuietly(() => deps.removeItem(LAST_WATCHED_STORAGE_KEY))
      for (const listener of clearListeners) {
        try {
          listener()
        } catch {
          // One failing listener must not hold back the others.
        }
      }
    },

    subscribeToClear(listener: () => void): () => void {
      clearListeners.add(listener)
      return () => {
        clearListeners.delete(listener)
      }
    },

    /** Module singletons outlive a test file; this is the seam that clears one
     *  without reaching into its internals. */
    reset(): void {
      record = null
      hydration = null
      clearEpoch = 0
      clearListeners.clear()
    },
  }
}

let store: LastWatchedStore | null = null

/** The app-wide last-watched record store. */
export function getLastWatchedStore(): LastWatchedStore {
  if (store == null) {
    store = createLastWatchedStore({
      getItem: (key) => AsyncStorage.getItem(key),
      setItem: (key, value) => AsyncStorage.setItem(key, value),
      removeItem: (key) => AsyncStorage.removeItem(key),
      now: () => new Date(),
    })
  }
  return store
}

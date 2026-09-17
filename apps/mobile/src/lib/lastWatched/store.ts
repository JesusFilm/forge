/**
 * The last-watched record store (KTD5): a plain module the reminder scheduler
 * and the playback subscriber both read without a React dependency.
 *
 * Memory is authoritative. A write sets memory and persists at once, and
 * hydration applies the stored record only when memory is still empty, so a
 * slow read can never overwrite a video the viewer just started. A clear
 * empties memory now and hands back its storage work, and no read applies a
 * stored record again until the next write (R11).
 */

import AsyncStorage from "@react-native-async-storage/async-storage"

import { withTimeout } from "../withTimeout"
import {
  LAST_WATCHED_STORAGE_KEY,
  parseStoredLastWatched,
  sanitizeLastWatchedTitle,
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

/** parseStoredLastWatched refuses this, so a removal that never lands still
 *  reads back as no record. */
const CLEARED_MARKER = ""

/** A storage seam that throws synchronously must not break its caller: the
 *  writer runs inside the playback store's notify loop. The returned promise
 *  settles with the operation and never rejects. */
function persistQuietly(operation: () => Promise<unknown>): Promise<void> {
  try {
    return operation().then(
      () => {},
      () => {},
    )
  } catch {
    // Storage is best-effort; memory already holds the authoritative record.
    return Promise.resolve()
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
  /**
   * Set by a clear, reset by a write. A clear's storage work can still be in
   * flight when a later read starts, so while this is set the store refuses
   * every stored record rather than restore the account that signed out.
   */
  let cleared = false

  /** Overwrite before removing: a removal that never lands then still reads
   *  back as no record on the next launch. */
  async function clearStorage(): Promise<void> {
    await persistQuietly(() =>
      deps.setItem(LAST_WATCHED_STORAGE_KEY, CLEARED_MARKER),
    )
    await persistQuietly(() => deps.removeItem(LAST_WATCHED_STORAGE_KEY))
  }

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
      let failed = false
      const flight = (async () => {
        let raw: string | null = null
        try {
          raw = await withTimeout(
            deps.getItem(LAST_WATCHED_STORAGE_KEY),
            LAST_WATCHED_HYDRATE_TIMEOUT_MS,
          )
        } catch {
          // Only the cold-launch pass is on a deadline. Memoizing a timeout
          // would send every later reminder to Home while a real record sat
          // on disk, so a FAILED read releases the memo and a later pass retries.
          failed = true
          return
        }
        if (clearEpoch !== epochAtStart) return
        if (cleared) {
          // The clear's own storage work has not landed, so the key can still
          // hold the account that signed out. Refuse it and remove it again.
          if (raw != null) void clearStorage()
          return
        }
        if (record != null) return
        record = parseStoredLastWatched(raw, deps.now())
      })()
      hydration = flight
      // The release is registered OUT HERE, on the flight. Inside the body it
      // runs before the assignment above when the read throws synchronously,
      // and the clobbered memo then holds the store at absent for good.
      const release = () => {
        if (failed && hydration === flight) hydration = null
      }
      void flight.then(release, release)
      return flight
    },

    write(videoSlug: string, videoTitle: string | null): void {
      const next: LastWatchedRecord = {
        videoSlug,
        videoTitle: sanitizeLastWatchedTitle(videoTitle),
        recordedAt: deps.now().getTime(),
      }
      const blob = serializeLastWatched(next)
      if (blob == null) return
      record = next
      cleared = false
      void persistQuietly(() => deps.setItem(LAST_WATCHED_STORAGE_KEY, blob))
    },

    /** R11/R18: empties memory NOW, drops the stored key, and tells the
     *  scheduler so the pending reminders stop naming the old video. The
     *  returned promise settles with the storage work, and never rejects. */
    clear(): Promise<void> {
      record = null
      clearEpoch += 1
      cleared = true
      const removal = clearStorage()
      for (const listener of clearListeners) {
        try {
          listener()
        } catch {
          // One failing listener must not hold back the others.
        }
      }
      return removal
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
      cleared = false
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

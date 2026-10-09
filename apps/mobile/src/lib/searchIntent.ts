import { useSyncExternalStore } from "react"

/**
 * Daily Bible Pause v2 (R16, KTD6): the run hands its question to the search
 * tab through this one-shot store. Navigation carries the path only, so a deep
 * link cannot fill the bar. A subscription, because on iOS the tab is mounted.
 */

/** Covers only the time from the exit's `dismissTo` to the tab's read. */
export const SEARCH_INTENT_TTL_MS = 30_000

/** Who wrote the intent. `watchSearch.ts` picks the query language from it. */
export type SearchIntentOrigin = "dailyPause"

/** Each put makes a new object, and the store and the tab compare intents by
 *  identity, so the same question twice is two intents. */
export type SearchIntent = {
  query: string
  origin: SearchIntentOrigin
  /** Epoch ms of the put. The time limit runs from here. */
  createdAt: number
}

export type SearchIntentStore = ReturnType<typeof createSearchIntentStore>

/** Holds at most one intent: a newer put outranks an older one. */
export function createSearchIntentStore(now: () => number = () => Date.now()) {
  let pending: SearchIntent | null = null
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((listener) => listener())

  return {
    /** The run is the only writer today. */
    put(query: string): SearchIntent {
      const intent: SearchIntent = {
        query,
        origin: "dailyPause",
        createdAt: now(),
      }
      pending = intent
      notify()
      return intent
    },
    /** The fresh intent, or null. Never consumes, so a render that runs twice
     *  reads the same intent twice. */
    peek(): SearchIntent | null {
      if (pending == null) return null
      return now() - pending.createdAt < SEARCH_INTENT_TTL_MS ? pending : null
    },
    /** After the tab applies the intent. A newer intent stays. */
    consume(intent: SearchIntent): void {
      if (pending !== intent) return
      pending = null
      notify()
    },
    clear(): void {
      if (pending == null) return
      pending = null
      notify()
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

let intents: SearchIntentStore | null = null

export function getSearchIntentStore(): SearchIntentStore {
  intents ??= createSearchIntentStore()
  return intents
}

export function usePendingSearchIntent(
  store: SearchIntentStore = getSearchIntentStore(),
): SearchIntent | null {
  return useSyncExternalStore(store.subscribe, store.peek, store.peek)
}

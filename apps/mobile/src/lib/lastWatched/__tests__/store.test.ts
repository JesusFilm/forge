/**
 * The last-watched record store (KTD5). Every case builds its own store over
 * its own fake storage, so no module singleton crosses a case.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

// The module's singleton binds AsyncStorage at import; the cases below never
// reach it.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)

import {
  LAST_WATCHED_HYDRATE_TIMEOUT_MS,
  createLastWatchedStore,
} from "../store"
import {
  LAST_WATCHED_STORAGE_KEY,
  parseStoredLastWatched,
  serializeLastWatched,
} from "../snapshot"
import { attachProgressLifecycle } from "../../watchProgress/lifecycle"

const NOW = new Date("2026-09-16T10:00:00.000Z")

function makeStorage(seed: string | null = null) {
  const items = new Map<string, string>()
  if (seed != null) items.set(LAST_WATCHED_STORAGE_KEY, seed)
  return {
    items,
    getItem: jest.fn(async (key: string) => items.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      items.set(key, value)
    }),
    removeItem: jest.fn(async (key: string) => {
      items.delete(key)
    }),
  }
}

function makeStore(seed: string | null = null, now: () => Date = () => NOW) {
  const storage = makeStorage(seed)
  const store = createLastWatchedStore({
    getItem: storage.getItem,
    setItem: storage.setItem,
    removeItem: storage.removeItem,
    now,
  })
  return { store, storage }
}

function blobFor(videoSlug: string, recordedAt = NOW.getTime()): string {
  return serializeLastWatched({
    videoSlug,
    videoTitle: null,
    recordedAt,
  }) as string
}

function storedSlug(storage: ReturnType<typeof makeStorage>): string | null {
  const raw = storage.items.get(LAST_WATCHED_STORAGE_KEY) ?? null
  return parseStoredLastWatched(raw, NOW)?.videoSlug ?? null
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

afterEach(() => {
  jest.useRealTimers()
})

describe("write", () => {
  it("sets memory and persists at once", async () => {
    const { store, storage } = makeStore()

    store.write("the-birth-of-jesus", null)

    expect(store.getRecord()).toEqual({
      videoSlug: "the-birth-of-jesus",
      videoTitle: null,
      recordedAt: NOW.getTime(),
    })
    await Promise.resolve()
    expect(storedSlug(storage)).toBe("the-birth-of-jesus")
  })

  it("replaces an earlier record", () => {
    const { store } = makeStore()

    store.write("first", null)
    store.write("second", null)

    expect(store.getRecord()?.videoSlug).toBe("second")
  })

  it("ignores a slug the snapshot would refuse", () => {
    const { store, storage } = makeStore()

    store.write("", null)

    expect(store.getRecord()).toBeNull()
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it("survives a storage seam that rejects", async () => {
    const { store, storage } = makeStore()
    storage.setItem.mockRejectedValue(new Error("disk full"))

    expect(() => store.write("the-birth-of-jesus", null)).not.toThrow()

    await Promise.resolve()
    expect(store.getRecord()?.videoSlug).toBe("the-birth-of-jesus")
  })

  it("survives a storage seam that throws synchronously", () => {
    const { store, storage } = makeStore()
    storage.setItem.mockImplementation(() => {
      throw new Error("no storage")
    })

    expect(() => store.write("the-birth-of-jesus", null)).not.toThrow()
    expect(store.getRecord()?.videoSlug).toBe("the-birth-of-jesus")
  })
})

describe("hydrate", () => {
  it("applies the stored record when memory is empty", async () => {
    const { store } = makeStore(blobFor("the-birth-of-jesus"))

    await store.hydrate()

    expect(store.getRecord()?.videoSlug).toBe("the-birth-of-jesus")
  })

  it("survives a process restart: a fresh store reads the last write back", async () => {
    const { store, storage } = makeStore()
    store.write("washi-gospel-1", null)
    await Promise.resolve()

    const restarted = createLastWatchedStore({
      getItem: storage.getItem,
      setItem: storage.setItem,
      removeItem: storage.removeItem,
      now: () => NOW,
    })
    await restarted.hydrate()

    expect(restarted.getRecord()?.videoSlug).toBe("washi-gospel-1")
  })

  it("leaves memory alone when a write landed first, and storage holds the write", async () => {
    const { store, storage } = makeStore()
    const read = deferred<string | null>()
    storage.getItem.mockReturnValue(read.promise)

    const hydration = store.hydrate()
    store.write("up-next-episode", null)
    read.resolve(blobFor("stale-from-storage"))
    await hydration

    expect(store.getRecord()?.videoSlug).toBe("up-next-episode")
    expect(storedSlug(storage)).toBe("up-next-episode")
  })

  it("discards its result when a clear landed first (AE9)", async () => {
    const { store, storage } = makeStore()
    const read = deferred<string | null>()
    storage.getItem.mockReturnValue(read.promise)

    const hydration = store.hydrate()
    store.clear()
    read.resolve(blobFor("previous-account-video"))
    await hydration

    expect(store.getRecord()).toBeNull()
  })

  it("leaves the store empty and does not throw when the read times out", async () => {
    jest.useFakeTimers()
    const { store, storage } = makeStore()
    storage.getItem.mockReturnValue(new Promise<string | null>(() => {}))

    const hydration = store.hydrate()
    jest.advanceTimersByTime(LAST_WATCHED_HYDRATE_TIMEOUT_MS + 1)

    await expect(hydration).resolves.toBeUndefined()
    expect(store.getRecord()).toBeNull()
  })

  it("leaves the store empty and does not throw when the read rejects", async () => {
    const { store, storage } = makeStore()
    storage.getItem.mockRejectedValue(new Error("storage unavailable"))

    await expect(store.hydrate()).resolves.toBeUndefined()
    expect(store.getRecord()).toBeNull()
  })

  it("reads storage once however many callers await it", async () => {
    const { store, storage } = makeStore(blobFor("the-birth-of-jesus"))

    await Promise.all([store.hydrate(), store.hydrate()])
    await store.hydrate()

    expect(storage.getItem).toHaveBeenCalledTimes(1)
  })

  it("retries after a rejected read, so a later pass still finds the record", async () => {
    // Only the cold-launch pass is on a deadline. Memoizing a failed read sends
    // every later reminder to Home while a real record sits on disk.
    const { store, storage } = makeStore()
    storage.getItem.mockRejectedValueOnce(new Error("storage unavailable"))
    storage.getItem.mockResolvedValueOnce(blobFor("the-birth-of-jesus"))

    await store.hydrate()
    expect(store.getRecord()).toBeNull()

    await store.hydrate()

    expect(storage.getItem).toHaveBeenCalledTimes(2)
    expect(store.getRecord()?.videoSlug).toBe("the-birth-of-jesus")
  })

  it("retries after a timed-out read", async () => {
    jest.useFakeTimers()
    const { store, storage } = makeStore()
    storage.getItem.mockReturnValueOnce(new Promise<string | null>(() => {}))

    const first = store.hydrate()
    jest.advanceTimersByTime(LAST_WATCHED_HYDRATE_TIMEOUT_MS + 1)
    await first
    expect(store.getRecord()).toBeNull()

    jest.useRealTimers()
    storage.getItem.mockResolvedValueOnce(blobFor("the-birth-of-jesus"))
    await store.hydrate()

    expect(store.getRecord()?.videoSlug).toBe("the-birth-of-jesus")
  })

  it("retries after a read seam that throws synchronously", async () => {
    // The throw lands in the async body's synchronous prologue, before the
    // memo it releases is assigned. The write path already survives this
    // seam; the read path must too.
    const { store, storage } = makeStore()
    storage.getItem.mockImplementationOnce(() => {
      throw new Error("no storage")
    })

    await expect(store.hydrate()).resolves.toBeUndefined()
    expect(store.getRecord()).toBeNull()

    storage.getItem.mockResolvedValueOnce(blobFor("the-birth-of-jesus"))
    await store.hydrate()

    expect(storage.getItem).toHaveBeenCalledTimes(2)
    expect(store.getRecord()?.videoSlug).toBe("the-birth-of-jesus")
  })

  it("does NOT retry after a successful read that found nothing", async () => {
    // An empty store is an answer. Retrying it would read on every pass.
    const { store, storage } = makeStore(null)

    await store.hydrate()
    await store.hydrate()

    expect(storage.getItem).toHaveBeenCalledTimes(1)
  })
})

describe("clear", () => {
  it("empties memory synchronously and removes the storage key", async () => {
    const { store, storage } = makeStore()
    store.write("the-birth-of-jesus", null)
    await Promise.resolve()

    const removal = store.clear()

    expect(store.getRecord()).toBeNull()
    await removal
    expect(storage.removeItem).toHaveBeenCalledWith(LAST_WATCHED_STORAGE_KEY)
    expect(storage.items.has(LAST_WATCHED_STORAGE_KEY)).toBe(false)
  })

  it("notifies its listeners once", () => {
    const { store } = makeStore()
    const listener = jest.fn()
    store.subscribeToClear(listener)

    store.clear()

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("stops notifying an unsubscribed listener", () => {
    const { store } = makeStore()
    const listener = jest.fn()
    const unsubscribe = store.subscribeToClear(listener)

    unsubscribe()
    store.clear()

    expect(listener).not.toHaveBeenCalled()
  })

  it("notifies every listener even when one throws", () => {
    const { store } = makeStore()
    const second = jest.fn()
    store.subscribeToClear(() => {
      throw new Error("scheduler exploded")
    })
    store.subscribeToClear(second)

    expect(() => store.clear()).not.toThrow()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it("survives a storage seam that throws synchronously", () => {
    const { store, storage } = makeStore()
    storage.removeItem.mockImplementation(() => {
      throw new Error("no storage")
    })

    expect(() => store.clear()).not.toThrow()
    expect(store.getRecord()).toBeNull()
  })

  it("reads back as no record in the next process when the removal rejects", async () => {
    // R11's one invariant: the signed-out account's video must not survive.
    const { store, storage } = makeStore()
    store.write("previous-account-video", null)
    await Promise.resolve()
    storage.removeItem.mockRejectedValue(new Error("disk full"))

    await store.clear()

    const restarted = createLastWatchedStore({
      getItem: storage.getItem,
      setItem: storage.setItem,
      removeItem: storage.removeItem,
      now: () => NOW,
    })
    await restarted.hydrate()

    expect(restarted.getRecord()).toBeNull()
  })

  it("fires the removal again when a later read still finds the key", async () => {
    // The clear's own storage work failed, so the key survived it. A later
    // read is the only event that can notice.
    const { store, storage } = makeStore(blobFor("previous-account-video"))
    storage.setItem.mockRejectedValueOnce(new Error("disk full"))
    storage.removeItem.mockRejectedValueOnce(new Error("disk full"))

    await store.clear()
    expect(storage.items.has(LAST_WATCHED_STORAGE_KEY)).toBe(true)

    await store.hydrate()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(store.getRecord()).toBeNull()
    expect(storage.items.has(LAST_WATCHED_STORAGE_KEY)).toBe(false)
  })

  it("refuses a fresh read that races an unfinished clear", async () => {
    // The record_cleared pass hydrates first. A timed-out cold-launch read
    // left no memo, so that pass starts a FRESH read while the clear's own
    // storage work is still in flight.
    const { store, storage } = makeStore(blobFor("previous-account-video"))
    jest.useFakeTimers()
    storage.getItem.mockReturnValueOnce(new Promise<string | null>(() => {}))
    const coldLaunch = store.hydrate()
    jest.advanceTimersByTime(LAST_WATCHED_HYDRATE_TIMEOUT_MS + 1)
    await coldLaunch
    jest.useRealTimers()
    const pending = () => new Promise<void>(() => {})
    storage.setItem.mockImplementation(pending)
    storage.removeItem.mockImplementation(pending)

    void store.clear()
    await store.hydrate()

    expect(store.getRecord()).toBeNull()
  })

  it("lets a later write record again", () => {
    const { store } = makeStore()
    store.write("first", null)

    store.clear()
    store.write("second", null)

    expect(store.getRecord()?.videoSlug).toBe("second")
  })
})

describe("sign-out, through the real progress lifecycle (AE9)", () => {
  // The record store and the lifecycle are both real here; only the session
  // and the progress storage are stand-ins. AuthProvider.test.tsx is what
  // pins that the app wires this dependency to this clear.
  it("leaves the storage key absent and calls the clear listener", async () => {
    const { store, storage } = makeStore()
    const listener = jest.fn()
    store.subscribeToClear(listener)
    store.write("previous-account-video", null)
    await Promise.resolve()
    let accountId: string | null = "user-1"
    const listeners = new Set<() => void>()

    attachProgressLifecycle({
      getAccountId: () => accountId,
      subscribe: (onChange) => {
        listeners.add(onChange)
        return () => listeners.delete(onChange)
      },
      hydrateFromSnapshot: async () => {},
      hydrateFromServer: async () => {},
      flushQueue: async () => {},
      resetStore: () => {},
      clearLastWatched: () => store.clear(),
      removeStorageItem: async () => {},
    })
    accountId = null
    for (const onChange of listeners) onChange()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(store.getRecord()).toBeNull()
    expect(storage.items.has(LAST_WATCHED_STORAGE_KEY)).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe("reset (the test seam)", () => {
  it("empties memory, drops listeners, and re-arms hydration", async () => {
    const { store, storage } = makeStore(blobFor("the-birth-of-jesus"))
    const listener = jest.fn()
    store.subscribeToClear(listener)
    await store.hydrate()

    store.reset()

    expect(store.getRecord()).toBeNull()
    store.clear()
    expect(listener).not.toHaveBeenCalled()
    await store.hydrate()
    expect(storage.getItem).toHaveBeenCalledTimes(2)
  })
})

describe("the title on the write path", () => {
  it("keeps the sanitized title in memory AND in storage", async () => {
    // The one production link in the titled chain that nothing else covers:
    // the reminder body reads the IN-MEMORY record, so a write that persisted
    // a title but did not hold it in memory would ship untitled reminders.
    const { store, storage } = makeStore()

    store.write("the-birth-of-jesus", "The Birth\nof Jesus")
    await Promise.resolve()

    expect(store.getRecord()?.videoTitle).toBe("The Birth of Jesus")
    const raw = storage.items.get(LAST_WATCHED_STORAGE_KEY) as string
    expect(JSON.parse(raw).videoTitle).toBe("The Birth of Jesus")
  })

  it("stores no title when the writer supplies none", () => {
    const { store } = makeStore()

    store.write("the-birth-of-jesus", null)

    expect(store.getRecord()?.videoTitle).toBeNull()
  })
})

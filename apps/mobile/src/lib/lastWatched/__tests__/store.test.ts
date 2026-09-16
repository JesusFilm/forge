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
  return serializeLastWatched({ videoSlug, recordedAt }) as string
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

    store.write("the-birth-of-jesus")

    expect(store.getRecord()).toEqual({
      videoSlug: "the-birth-of-jesus",
      recordedAt: NOW.getTime(),
    })
    await Promise.resolve()
    expect(storedSlug(storage)).toBe("the-birth-of-jesus")
  })

  it("replaces an earlier record", () => {
    const { store } = makeStore()

    store.write("first")
    store.write("second")

    expect(store.getRecord()?.videoSlug).toBe("second")
  })

  it("ignores a slug the snapshot would refuse", () => {
    const { store, storage } = makeStore()

    store.write("")

    expect(store.getRecord()).toBeNull()
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it("survives a storage seam that rejects", async () => {
    const { store, storage } = makeStore()
    storage.setItem.mockRejectedValue(new Error("disk full"))

    expect(() => store.write("the-birth-of-jesus")).not.toThrow()

    await Promise.resolve()
    expect(store.getRecord()?.videoSlug).toBe("the-birth-of-jesus")
  })

  it("survives a storage seam that throws synchronously", () => {
    const { store, storage } = makeStore()
    storage.setItem.mockImplementation(() => {
      throw new Error("no storage")
    })

    expect(() => store.write("the-birth-of-jesus")).not.toThrow()
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
    store.write("washi-gospel-1")
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
    store.write("up-next-episode")
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
})

describe("clear", () => {
  it("empties memory synchronously and removes the storage key", async () => {
    const { store, storage } = makeStore()
    store.write("the-birth-of-jesus")
    await Promise.resolve()

    store.clear()

    expect(store.getRecord()).toBeNull()
    await Promise.resolve()
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

  it("lets a later write record again", () => {
    const { store } = makeStore()
    store.write("first")

    store.clear()
    store.write("second")

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
    store.write("previous-account-video")
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

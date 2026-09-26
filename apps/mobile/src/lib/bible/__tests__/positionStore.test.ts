/**
 * The reading position store (feat-553 U5, KTD5). Each case builds its own
 * store over its own fake storage, so no module singleton crosses a case.
 * The hook cases wrap the element in StrictMode (RTL is not installed here).
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)

import AsyncStorage from "@react-native-async-storage/async-storage"
import { StrictMode, act, createElement } from "react"

import {
  TestRenderer,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import {
  DEFAULT_READING_REF,
  READING_POSITION_STORAGE_KEY,
  READING_POSITION_VERSION,
  parseStoredReadingPosition,
  serializeReadingPosition,
} from "../position/snapshot"
import {
  READING_POSITION_HYDRATE_TIMEOUT_MS,
  createReadingPositionStore,
  getReadingPositionStore,
  readerStartRef,
  resetReadingPositionStoreForTests,
  useReadingPosition,
  type ReadingPositionSnapshot,
  type ReadingPositionStore,
} from "../position/store"
import type { VerseRef } from "../versification/convert"

const KEY = READING_POSITION_STORAGE_KEY
const JOHN_3_16: VerseRef = { book: "JHN", chapter: 3, verse: 16 }
const JOHN_3_17: VerseRef = { book: "JHN", chapter: 3, verse: 17 }
const JOHN_3_18: VerseRef = { book: "JHN", chapter: 3, verse: 18 }
const ROMANS_8_5: VerseRef = { book: "ROM", chapter: 8, verse: 5 }

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}

function makeStorage(seed: string | null = null) {
  const items = new Map<string, string>()
  if (seed != null) items.set(KEY, seed)
  const log: string[] = []
  return {
    items,
    log,
    getItem: jest.fn(async (key: string) => {
      log.push("get")
      return items.get(key) ?? null
    }),
    setItem: jest.fn(async (key: string, value: string) => {
      log.push("set")
      items.set(key, value)
    }),
  }
}

type FakeStorage = ReturnType<typeof makeStorage>

function blob(ref: VerseRef | null, translationId: string | null = null) {
  return serializeReadingPosition({ ref, translationId })
}

function stored(storage: FakeStorage) {
  return parseStoredReadingPosition(storage.items.get(KEY) ?? null)
}

async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

afterEach(() => {
  jest.useRealTimers()
})

describe("snapshot", () => {
  it("round-trips a position and a pick", () => {
    const raw = blob(ROMANS_8_5, "rus_syn")

    expect(JSON.parse(raw)).toMatchObject({
      version: READING_POSITION_VERSION,
    })
    expect(parseStoredReadingPosition(raw)).toEqual({
      ref: ROMANS_8_5,
      translationId: "rus_syn",
    })
  })

  it("reads bad JSON, another version, or no data as no record", () => {
    const olderVersion = JSON.stringify({
      version: READING_POSITION_VERSION - 1,
      ref: ROMANS_8_5,
      translationId: null,
    })

    expect(parseStoredReadingPosition(null)).toBeNull()
    expect(parseStoredReadingPosition("{not json")).toBeNull()
    expect(parseStoredReadingPosition("[]")).toBeNull()
    expect(parseStoredReadingPosition(olderVersion)).toBeNull()
  })

  it("reads a reference that is not a BSB verse as no position", () => {
    const shape = (ref: unknown) =>
      JSON.stringify({ version: READING_POSITION_VERSION, ref })

    expect(parseStoredReadingPosition(shape(JOHN_3_16))?.ref).toEqual(JOHN_3_16)
    // John 3 has 36 verses in BSB.
    expect(
      parseStoredReadingPosition(shape({ ...JOHN_3_16, verse: 36 }))?.ref,
    ).toEqual({ ...JOHN_3_16, verse: 36 })
    for (const bad of [
      { ...JOHN_3_16, verse: 37 },
      { ...JOHN_3_16, chapter: 22 },
      { ...JOHN_3_16, verse: 0 },
      { ...JOHN_3_16, verse: 1.5 },
      { ...JOHN_3_16, book: "XYZ" },
      { ...JOHN_3_16, chapter: "3" },
      "JHN 3:16",
    ]) {
      expect(parseStoredReadingPosition(shape(bad))?.ref ?? null).toBeNull()
    }
  })

  it("reads an unsafe translation id as no pick", () => {
    const raw = JSON.stringify({
      version: READING_POSITION_VERSION,
      ref: JOHN_3_16,
      translationId: "../rus_syn",
    })

    expect(parseStoredReadingPosition(raw)).toEqual({
      ref: JOHN_3_16,
      translationId: null,
    })
  })
})

describe("R3, R4: reads and moves", () => {
  it("opens a fresh install at John 3:16 once the read settles", async () => {
    const store = createReadingPositionStore(makeStorage())

    expect(store.getSnapshot().status).toBe("loading")
    expect(readerStartRef(store.getSnapshot())).toBeNull()

    await store.hydrate()

    expect(store.getSnapshot()).toMatchObject({ status: "ready", ref: null })
    expect(readerStartRef(store.getSnapshot())).toEqual(DEFAULT_READING_REF)
    expect(DEFAULT_READING_REF).toEqual(JOHN_3_16)
  })

  it("opens at John 3:16 when the snapshot is corrupt or from another version", async () => {
    for (const raw of [
      "{corrupt",
      JSON.stringify({ version: 99, ref: ROMANS_8_5, translationId: null }),
    ]) {
      const store = createReadingPositionStore(makeStorage(raw))
      await store.hydrate()
      expect(readerStartRef(store.getSnapshot())).toEqual(JOHN_3_16)
    }
  })

  it("opens at the stored position", async () => {
    const store = createReadingPositionStore(makeStorage(blob(ROMANS_8_5)))

    await store.hydrate()

    expect(readerStartRef(store.getSnapshot())).toEqual(ROMANS_8_5)
  })

  it("saves each move, and a restart reads the last one back", async () => {
    const storage = makeStorage()
    const store = createReadingPositionStore(storage)
    await store.hydrate()

    expect(store.moveTo(JOHN_3_16)).toBe(true)
    expect(store.moveTo(JOHN_3_17)).toBe(true)
    await settle()

    expect(stored(storage)?.ref).toEqual(JOHN_3_17)
    const restarted = createReadingPositionStore(storage)
    await restarted.hydrate()
    expect(restarted.getSnapshot().ref).toEqual(JOHN_3_17)
  })

  it("covers AE2: a quote move then a tab read returns the quote's last verse", async () => {
    const storage = makeStorage(blob(ROMANS_8_5))
    const store = createReadingPositionStore(storage)
    await store.hydrate()
    expect(readerStartRef(store.getSnapshot())).toEqual(ROMANS_8_5)

    // The pushed reader opens the quote, and the viewer reads to its end.
    store.moveTo(JOHN_3_16)
    store.moveTo(JOHN_3_17)
    store.moveTo(JOHN_3_18)
    await settle()

    expect(readerStartRef(store.getSnapshot())).toEqual(JOHN_3_18)
    const nextLaunch = createReadingPositionStore(storage)
    await nextLaunch.hydrate()
    expect(readerStartRef(nextLaunch.getSnapshot())).toEqual(JOHN_3_18)
  })

  it("neither notifies nor writes for a move to the same verse", async () => {
    const storage = makeStorage()
    const store = createReadingPositionStore(storage)
    await store.hydrate()
    store.moveTo(JOHN_3_16)
    await settle()
    const listener = jest.fn()
    store.subscribe(listener)
    const writes = storage.setItem.mock.calls.length

    store.moveTo({ ...JOHN_3_16 })
    await settle()

    expect(listener).not.toHaveBeenCalled()
    expect(storage.setItem).toHaveBeenCalledTimes(writes)
  })

  it("refuses a reference that is not a BSB verse", async () => {
    const storage = makeStorage()
    const store = createReadingPositionStore(storage)
    await store.hydrate()

    expect(store.moveTo({ ...JOHN_3_16, verse: 37 })).toBe(false)
    expect(store.moveTo({ ...JOHN_3_16, chapter: 0 })).toBe(false)
    await settle()

    expect(store.getSnapshot().ref).toBeNull()
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it("keeps one snapshot object until something changes", async () => {
    const store = createReadingPositionStore(makeStorage())
    await store.hydrate()
    const first = store.getSnapshot()

    expect(store.getSnapshot()).toBe(first)
    store.moveTo(JOHN_3_16)
    expect(store.getSnapshot()).not.toBe(first)
  })
})

describe("AE15: a live move before the saved position loads", () => {
  it("keeps a move written before hydration ends over the late result", async () => {
    const storage = makeStorage()
    const read = deferred<string | null>()
    storage.getItem.mockReturnValueOnce(read.promise)
    const store = createReadingPositionStore(storage)
    const listener = jest.fn()
    store.subscribe(listener)

    store.moveTo(JOHN_3_16)
    read.resolve(blob(ROMANS_8_5))
    await settle()

    expect(store.getSnapshot()).toMatchObject({
      status: "ready",
      ref: JOHN_3_16,
    })
    expect(stored(storage)?.ref).toEqual(JOHN_3_16)
    expect(listener).toHaveBeenCalled()
  })

  it("starts the read before its own write, so the stored pick survives", async () => {
    const storage = makeStorage(blob(ROMANS_8_5, "rus_syn"))
    const store = createReadingPositionStore(storage)

    // The pushed route writes before any reader subscribes (U11).
    store.moveTo(JOHN_3_16)
    await settle()

    expect(storage.log[0]).toBe("get")
    expect(store.getSnapshot()).toMatchObject({
      ref: JOHN_3_16,
      translationId: "rus_syn",
    })
    expect(stored(storage)).toEqual({
      ref: JOHN_3_16,
      translationId: "rus_syn",
    })
  })

  it("keeps a pick written before hydration ends and adopts the stored position", async () => {
    const storage = makeStorage(blob(ROMANS_8_5, "rus_syn"))
    const read = deferred<string | null>()
    storage.getItem.mockReturnValueOnce(read.promise)
    const store = createReadingPositionStore(storage)
    void store.hydrate()

    store.pickTranslation("spa_bes")
    read.resolve(blob(ROMANS_8_5, "rus_syn"))
    await settle()

    expect(store.getSnapshot()).toMatchObject({
      ref: ROMANS_8_5,
      translationId: "spa_bes",
    })
    expect(stored(storage)).toEqual({
      ref: ROMANS_8_5,
      translationId: "spa_bes",
    })
  })
})

describe("a read that fails", () => {
  it("opens at John 3:16 after the time limit, and a later read still applies", async () => {
    jest.useFakeTimers()
    const storage = makeStorage(blob(ROMANS_8_5))
    storage.getItem.mockReturnValueOnce(new Promise<string | null>(() => {}))
    const store = createReadingPositionStore(storage)

    const first = store.hydrate()
    await jest.advanceTimersByTimeAsync(READING_POSITION_HYDRATE_TIMEOUT_MS)
    await first

    expect(store.getSnapshot()).toMatchObject({ status: "ready", ref: null })
    expect(readerStartRef(store.getSnapshot())).toEqual(JOHN_3_16)

    await store.hydrate()
    expect(store.getSnapshot().ref).toEqual(ROMANS_8_5)
  })

  it("never saves over a record it has not read", async () => {
    const storage = makeStorage(blob(ROMANS_8_5, "rus_syn"))
    storage.getItem.mockRejectedValueOnce(new Error("disk busy"))
    const store = createReadingPositionStore(storage)
    await store.hydrate()
    expect(store.getSnapshot().status).toBe("ready")

    store.moveTo(JOHN_3_16)
    await settle()

    for (const [, value] of storage.setItem.mock.calls) {
      expect(parseStoredReadingPosition(value)?.translationId).toBe("rus_syn")
    }
    expect(stored(storage)).toEqual({
      ref: JOHN_3_16,
      translationId: "rus_syn",
    })
  })

  it("reads again after a read that throws synchronously", async () => {
    const storage = makeStorage(blob(ROMANS_8_5))
    storage.getItem.mockImplementationOnce(() => {
      throw new Error("no storage")
    })
    const store = createReadingPositionStore(storage)

    await store.hydrate()
    expect(store.getSnapshot()).toMatchObject({ status: "ready", ref: null })
    await store.hydrate()

    expect(store.getSnapshot().ref).toEqual(ROMANS_8_5)
  })

  it("drops a read that a reset made stale", async () => {
    const storage = makeStorage()
    const read = deferred<string | null>()
    storage.getItem.mockReturnValueOnce(read.promise)
    const store = createReadingPositionStore(storage)
    const stale = store.hydrate()

    store.reset()
    read.resolve(blob(ROMANS_8_5))
    await stale

    expect(store.getSnapshot()).toMatchObject({ status: "loading", ref: null })
  })

  it("survives a storage seam that rejects or throws", async () => {
    const storage = makeStorage()
    const store = createReadingPositionStore(storage)
    await store.hydrate()
    storage.setItem.mockRejectedValueOnce(new Error("disk full"))
    storage.setItem.mockImplementationOnce(() => {
      throw new Error("no storage")
    })

    expect(() => store.moveTo(JOHN_3_16)).not.toThrow()
    expect(() => store.moveTo(JOHN_3_17)).not.toThrow()
    await settle()

    expect(store.getSnapshot().ref).toEqual(JOHN_3_17)
  })
})

describe("R41: the saved pick and the session switch", () => {
  it("saves an explicit pick, and it survives a restart", async () => {
    const storage = makeStorage()
    const store = createReadingPositionStore(storage)
    await store.hydrate()

    expect(store.pickTranslation("rus_syn")).toBe(true)
    await settle()

    const restarted = createReadingPositionStore(storage)
    await restarted.hydrate()
    expect(restarted.getSnapshot().translationId).toBe("rus_syn")
  })

  it("keeps the R31 switch out of storage and ends it with the session", async () => {
    const storage = makeStorage()
    const store = createReadingPositionStore(storage)
    await store.hydrate()
    store.moveTo(JOHN_3_16)

    expect(store.switchTranslationForSession("BSB")).toBe(true)
    store.moveTo(JOHN_3_17)
    await settle()

    expect(store.getSnapshot().sessionTranslationId).toBe("BSB")
    expect(stored(storage)).toEqual({ ref: JOHN_3_17, translationId: null })
    const restarted = createReadingPositionStore(storage)
    await restarted.hydrate()
    expect(restarted.getSnapshot()).toMatchObject({
      ref: JOHN_3_17,
      translationId: null,
      sessionTranslationId: null,
    })
  })

  it("keeps a return to the default, made before the read, over the stored pick", async () => {
    const storage = makeStorage(blob(ROMANS_8_5, "rus_syn"))
    const store = createReadingPositionStore(storage)

    store.pickTranslation(null)
    await settle()

    expect(store.getSnapshot()).toMatchObject({
      ref: ROMANS_8_5,
      translationId: null,
    })
    expect(stored(storage)).toEqual({ ref: ROMANS_8_5, translationId: null })
  })

  it("ends the session switch when the viewer picks a translation", async () => {
    const store = createReadingPositionStore(makeStorage())
    await store.hydrate()
    store.switchTranslationForSession("BSB")

    store.pickTranslation("spa_bes")

    expect(store.getSnapshot()).toMatchObject({
      translationId: "spa_bes",
      sessionTranslationId: null,
    })
  })

  it("refuses an unsafe translation id", async () => {
    const store = createReadingPositionStore(makeStorage())
    await store.hydrate()

    expect(store.pickTranslation("../x")).toBe(false)
    expect(store.switchTranslationForSession("")).toBe(false)
    expect(store.getSnapshot()).toMatchObject({
      translationId: null,
      sessionTranslationId: null,
    })
  })
})

describe("useReadingPosition under StrictMode", () => {
  const mounted: TestInstance[] = []

  afterEach(() => {
    act(() => {
      mounted.splice(0).forEach((renderer) => renderer.unmount())
    })
  })

  function spied(store: ReadingPositionStore) {
    const events: string[] = []
    const subscribe = (listener: () => void) => {
      events.push("subscribe")
      const unsubscribe = store.subscribe(listener)
      return () => {
        events.push("unsubscribe")
        unsubscribe()
      }
    }
    return { store: { ...store, subscribe }, events }
  }

  function renderHosts(store: ReadingPositionStore, hosts = 1) {
    const seen: ReadingPositionSnapshot[][] = Array.from(
      { length: hosts },
      () => [],
    )
    function Host({ index }: { index: number }) {
      seen[index]?.push(useReadingPosition(store))
      return null
    }
    const children = seen.map((_, index) =>
      createElement(Host, { key: index, index }),
    )
    act(() => {
      mounted.push(
        TestRenderer.create(createElement(StrictMode, null, ...children)),
      )
    })
    return (index = 0) => {
      const list = seen[index] ?? []
      return list[list.length - 1]
    }
  }

  it("runs the remount cycle, reads once, and shows the stored position", async () => {
    const storage = makeStorage(blob(ROMANS_8_5))
    const { store, events } = spied(createReadingPositionStore(storage))

    const latest = renderHosts(store)
    await act(settle)

    // Anti-vacuous: StrictMode really ran setup, cleanup, setup.
    expect(events.slice(0, 3)).toEqual([
      "subscribe",
      "unsubscribe",
      "subscribe",
    ])
    expect(storage.getItem).toHaveBeenCalledTimes(1)
    expect(latest()).toMatchObject({ status: "ready", ref: ROMANS_8_5 })
  })

  it("shows a move in every host after the cycle (AE2)", async () => {
    const store = createReadingPositionStore(makeStorage(blob(ROMANS_8_5)))
    const latest = renderHosts(store, 2)
    await act(settle)

    act(() => {
      store.moveTo(JOHN_3_18)
    })

    expect(latest(0)?.ref).toEqual(JOHN_3_18)
    expect(latest(1)?.ref).toEqual(JOHN_3_18)
  })

  it("keeps a quote move made before the read settles (AE15)", async () => {
    const storage = makeStorage()
    const read = deferred<string | null>()
    storage.getItem.mockReturnValueOnce(read.promise)
    const store = createReadingPositionStore(storage)
    const latest = renderHosts(store)
    expect(latest()?.status).toBe("loading")

    act(() => {
      store.moveTo(JOHN_3_16)
    })
    expect(readerStartRef(latest() as ReadingPositionSnapshot)).toEqual(
      JOHN_3_16,
    )
    await act(async () => {
      read.resolve(blob(ROMANS_8_5))
      await settle()
    })

    expect(latest()).toMatchObject({ status: "ready", ref: JOHN_3_16 })
  })
})

describe("the app store", () => {
  beforeEach(async () => {
    resetReadingPositionStoreForTests()
    await AsyncStorage.clear()
  })

  it("is one store that saves under the position key", async () => {
    const store = getReadingPositionStore()
    expect(getReadingPositionStore()).toBe(store)

    await store.hydrate()
    store.moveTo(JOHN_3_16)
    await settle()

    const raw = await AsyncStorage.getItem(KEY)
    expect(parseStoredReadingPosition(raw)?.ref).toEqual(JOHN_3_16)
  })
})

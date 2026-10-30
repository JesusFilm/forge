/**
 * The Explore clip record (KTD15). Every case builds its own store over its own
 * fake storage and clock, so no module singleton crosses a case.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

// The module's singleton binds AsyncStorage at import; the cases below never
// reach it.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)

import {
  CLIP_RECORD_HYDRATE_TIMEOUT_MS,
  CLIP_RECORD_MAX_AGE_MS,
  CLIP_RECORD_MAX_ENTRIES,
  CLIP_RECORD_STORAGE_KEY,
  CLIP_RECORD_VERSION,
  CLIP_RECORD_WRITE_INTERVAL_MS,
  createClipRecordStore,
  daysBetweenDateKeys,
  localDateKey,
  parseStoredClipRecord,
  serializeClipRecord,
  type ClipRecordEntry,
} from "../clipRecord"

const T0 = new Date(2026, 8, 25, 10, 0, 0).getTime()
const DAY_MS = 24 * 60 * 60 * 1000

function makeStorage(seed: string | null = null) {
  const items = new Map<string, string>()
  if (seed != null) items.set(CLIP_RECORD_STORAGE_KEY, seed)
  return {
    items,
    getItem: jest.fn(async (key: string) => items.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      items.set(key, value)
    }),
  }
}

function makeStore(seed: string | null = null) {
  const storage = makeStorage(seed)
  const clock = { now: T0 }
  const store = createClipRecordStore({
    getItem: storage.getItem,
    setItem: storage.setItem,
    now: () => new Date(clock.now),
  })
  return { store, storage, clock }
}

function entry(
  videoId: string,
  startSeconds: number,
  overrides: Partial<ClipRecordEntry> = {},
): ClipRecordEntry {
  return {
    videoId,
    languageSlug: "english",
    startSeconds,
    endSeconds: startSeconds + 28,
    shownAt: T0,
    ...overrides,
  }
}

/** `writtenAt` is when the blob reached storage; the serializer drops what
 *  had already expired by then. */
function seedBlob(
  entries: ClipRecordEntry[],
  lastVisitDate: string | null = null,
  writtenAt = T0,
): string {
  return serializeClipRecord({ entries, lastVisitDate }, new Date(writtenAt))
}

function storedEntries(storage: ReturnType<typeof makeStorage>, at = T0) {
  const raw = storage.items.get(CLIP_RECORD_STORAGE_KEY) ?? null
  return parseStoredClipRecord(raw, new Date(at)).entries
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

// Every add arms a 5 s write timer; fake timers keep it inside the case.
beforeEach(() => {
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

describe("parseStoredClipRecord / serializeClipRecord", () => {
  it("round-trips entries in order, with the last visit date", () => {
    const entries = [
      entry("video-a", 2410.123),
      entry("video-b", 61.5, { languageSlug: "swahili", shownAt: T0 + 1 }),
      entry("video-a", 12.04, { shownAt: T0 + 2 }),
    ]
    const raw = serializeClipRecord(
      { entries, lastVisitDate: "2026-09-24" },
      new Date(T0),
    )
    expect(parseStoredClipRecord(raw, new Date(T0))).toEqual({
      entries,
      lastVisitDate: "2026-09-24",
    })
  })

  it("writes each video id and language once, not once per entry", () => {
    const entries = Array.from({ length: 50 }, (_, i) =>
      entry("a-long-admin-video-id-0001", i * 60),
    )
    const raw = serializeClipRecord(
      { entries, lastVisitDate: null },
      new Date(T0),
    )
    expect(raw.split("a-long-admin-video-id-0001")).toHaveLength(2)
    expect(raw.split("english")).toHaveLength(2)
    expect(JSON.parse(raw).v).toBe(CLIP_RECORD_VERSION)
  })

  it("reads a corrupt or wrong-version snapshot as empty, without throwing", () => {
    const empty = { entries: [], lastVisitDate: null }
    const now = new Date(T0)
    expect(parseStoredClipRecord(null, now)).toEqual(empty)
    expect(parseStoredClipRecord("{not json", now)).toEqual(empty)
    expect(parseStoredClipRecord("42", now)).toEqual(empty)
    expect(parseStoredClipRecord("[]", now)).toEqual(empty)
    expect(parseStoredClipRecord('{"v":1,"e":"x"}', now)).toEqual(empty)
    const good = JSON.parse(seedBlob([entry("video-a", 10)], "2026-09-24"))
    expect(
      parseStoredClipRecord(JSON.stringify({ ...good, v: 99 }), now),
    ).toEqual(empty)
  })

  it("drops a malformed entry and keeps the rest", () => {
    const raw = JSON.stringify({
      v: CLIP_RECORD_VERSION,
      d: "not-a-date",
      ids: ["video-a", ""],
      langs: ["english"],
      e: [
        [0, 0, 10000, 38000, T0],
        [1, 0, 10000, 38000, T0], // empty video id
        [0, 3, 10000, 38000, T0], // language index out of range
        [0, 0, 38000, 10000, T0], // end before start
        [0, 0, -5, 38000, T0], // negative start
        ["0", 0, 10000, 38000, T0], // index is not a number
        [0, 0, 60000, 90000], // too short
      ],
    })
    const parsed = parseStoredClipRecord(raw, new Date(T0))
    expect(parsed.entries).toEqual([entry("video-a", 10)])
    expect(parsed.lastVisitDate).toBeNull()
  })

  it("drops an entry older than 7 days", () => {
    const entries = [
      entry("video-a", 10, { shownAt: T0 - CLIP_RECORD_MAX_AGE_MS - 1 }),
      entry("video-b", 10, { shownAt: T0 - CLIP_RECORD_MAX_AGE_MS }),
    ]
    // Written two days ago, while both entries were fresh.
    const raw = seedBlob(entries, null, T0 - 2 * DAY_MS)
    expect(JSON.parse(raw).e).toHaveLength(2)
    expect(
      parseStoredClipRecord(raw, new Date(T0)).entries.map((e) => e.videoId),
    ).toEqual(["video-b"])
  })

  it("leaves an expired entry out of the serialized blob", () => {
    const raw = seedBlob([
      entry("video-a", 10, { shownAt: T0 - CLIP_RECORD_MAX_AGE_MS - 1 }),
      entry("video-b", 10, { shownAt: T0 - CLIP_RECORD_MAX_AGE_MS }),
    ])
    expect(JSON.parse(raw)).toMatchObject({ ids: ["video-b"] })
    expect(JSON.parse(raw).e).toHaveLength(1)
  })
})

describe("hydrate", () => {
  it("drops an entry older than 7 days", async () => {
    const { store } = makeStore(
      seedBlob(
        [
          entry("video-old", 10, { shownAt: T0 - 8 * DAY_MS }),
          entry("video-new", 10, { shownAt: T0 - DAY_MS }),
        ],
        null,
        T0 - 3 * DAY_MS,
      ),
    )
    await store.hydrate()
    expect(store.getEntries().map((e) => e.videoId)).toEqual(["video-new"])
  })

  it("reads a corrupt snapshot as empty, and the next write replaces it", async () => {
    const { store, storage } = makeStore("{corrupt")
    await expect(store.hydrate()).resolves.toBeUndefined()
    expect(store.getEntries()).toEqual([])

    store.add({
      videoId: "video-a",
      languageSlug: "english",
      startSeconds: 10,
      endSeconds: 38,
    })
    await store.flushNow()
    expect(storedEntries(storage)).toEqual([entry("video-a", 10)])
  })

  it("reads a wrong-version snapshot as empty", async () => {
    const good = JSON.parse(seedBlob([entry("video-a", 10)]))
    const { store } = makeStore(JSON.stringify({ ...good, v: 0 }))
    await store.hydrate()
    expect(store.getEntries()).toEqual([])
  })

  it("never rejects when the read fails", async () => {
    const { store, storage } = makeStore()
    storage.getItem.mockRejectedValueOnce(new Error("disk"))
    await expect(store.hydrate()).resolves.toBeUndefined()
    expect(store.getEntries()).toEqual([])
  })

  it("never rejects when the read throws synchronously", async () => {
    const { store, storage } = makeStore()
    storage.getItem.mockImplementationOnce(() => {
      throw new Error("native module missing")
    })
    await expect(store.hydrate()).resolves.toBeUndefined()
  })

  it("stops waiting at the timeout, and merges the read when it lands", async () => {
    const { store, storage } = makeStore()
    const read = deferred<string | null>()
    storage.getItem.mockReturnValueOnce(read.promise)

    let settled = false
    void store.hydrate().then(() => {
      settled = true
    })
    await jest.advanceTimersByTimeAsync(CLIP_RECORD_HYDRATE_TIMEOUT_MS)
    expect(settled).toBe(true)

    store.add({
      videoId: "video-now",
      languageSlug: "english",
      startSeconds: 5,
      endSeconds: 20,
    })
    const versionBefore = store.getVersion()
    read.resolve(seedBlob([entry("video-then", 10, { shownAt: T0 - DAY_MS })]))
    await jest.advanceTimersByTimeAsync(0)

    expect(store.getEntries().map((e) => e.videoId)).toEqual([
      "video-then",
      "video-now",
    ])
    expect(store.getVersion()).not.toBe(versionBefore)
  })
})

describe("add", () => {
  it("records the video, window, language, and the time it played", () => {
    const { store, clock } = makeStore()
    clock.now = T0 + 1234
    expect(
      store.add({
        videoId: "video-a",
        languageSlug: "swahili",
        startSeconds: 2410.1234,
        endSeconds: 2438.9,
      }),
    ).toBe(true)
    expect(store.getEntries()).toEqual([
      {
        videoId: "video-a",
        languageSlug: "swahili",
        startSeconds: 2410.123,
        endSeconds: 2438.9,
        shownAt: T0 + 1234,
      },
    ])
  })

  it("keeps one entry when the record already holds the clip (a replay)", () => {
    const { store } = makeStore()
    const clip = {
      videoId: "video-a",
      languageSlug: "english",
      startSeconds: 40 * 60 + 10,
      endSeconds: 40 * 60 + 38,
    }
    expect(store.add(clip)).toBe(true)
    const version = store.getVersion()
    expect(store.add(clip)).toBe(false)
    expect(store.getEntries()).toHaveLength(1)
    expect(store.getVersion()).toBe(version)
  })

  it("evicts the oldest entry on the 2,001st add", () => {
    const { store, clock } = makeStore()
    for (let i = 0; i < CLIP_RECORD_MAX_ENTRIES; i += 1) {
      clock.now = T0 + i
      store.add({
        videoId: `video-${i}`,
        languageSlug: "english",
        startSeconds: 10,
        endSeconds: 38,
      })
    }
    expect(store.getEntries()).toHaveLength(CLIP_RECORD_MAX_ENTRIES)
    expect(store.getEntries()[0].videoId).toBe("video-0")

    store.add({
      videoId: "video-2000",
      languageSlug: "english",
      startSeconds: 10,
      endSeconds: 38,
    })
    const entries = store.getEntries()
    expect(entries).toHaveLength(CLIP_RECORD_MAX_ENTRIES)
    expect(entries[0].videoId).toBe("video-1")
    expect(entries[entries.length - 1].videoId).toBe("video-2000")
  })

  it("refuses a window that could never be read back", () => {
    const { store } = makeStore()
    const base = { videoId: "video-a", languageSlug: "english" }
    expect(store.add({ ...base, startSeconds: 20, endSeconds: 10 })).toBe(false)
    expect(store.add({ ...base, startSeconds: -1, endSeconds: 10 })).toBe(false)
    expect(
      store.add({ ...base, startSeconds: Number.NaN, endSeconds: 10 }),
    ).toBe(false)
    expect(
      store.add({
        videoId: "",
        languageSlug: "english",
        startSeconds: 0,
        endSeconds: 10,
      }),
    ).toBe(false)
    expect(store.getEntries()).toEqual([])
  })
})

describe("getWindows and getVersion", () => {
  it("returns only that video's windows, ordered by start", () => {
    const { store } = makeStore()
    store.add({
      videoId: "jesus",
      languageSlug: "english",
      startSeconds: 2410,
      endSeconds: 2438,
    })
    store.add({
      videoId: "other",
      languageSlug: "english",
      startSeconds: 5,
      endSeconds: 30,
    })
    store.add({
      videoId: "jesus",
      languageSlug: "english",
      startSeconds: 60,
      endSeconds: 90,
    })
    expect(store.getWindows("jesus")).toEqual([
      { startSeconds: 60, endSeconds: 90 },
      { startSeconds: 2410, endSeconds: 2438 },
    ])
    expect(store.getWindows("nobody")).toEqual([])
  })

  it("changes the version whenever the windows change", () => {
    const { store } = makeStore()
    const v0 = store.getVersion()
    store.add({
      videoId: "jesus",
      languageSlug: "english",
      startSeconds: 60,
      endSeconds: 90,
    })
    const v1 = store.getVersion()
    expect(v1).not.toBe(v0)
    store.releaseOldestForLanguage("english", 1)
    expect(store.getVersion()).not.toBe(v1)
  })

  it("drops an entry older than 7 days on read, and changes the version", () => {
    const { store, clock } = makeStore()
    store.add({
      videoId: "jesus",
      languageSlug: "english",
      startSeconds: 60,
      endSeconds: 90,
    })
    const version = store.getVersion()

    clock.now = T0 + CLIP_RECORD_MAX_AGE_MS
    expect(store.getWindows("jesus")).toHaveLength(1)

    clock.now = T0 + CLIP_RECORD_MAX_AGE_MS + 1
    expect(store.getWindows("jesus")).toEqual([])
    expect(store.getEntries()).toEqual([])
    expect(store.getVersion()).not.toBe(version)
  })
})

describe("releaseOldestForLanguage (R31)", () => {
  it("removes only that language's oldest entries", () => {
    const { store, clock } = makeStore()
    const add = (videoId: string, languageSlug: string) => {
      clock.now += 1000
      store.add({ videoId, languageSlug, startSeconds: 10, endSeconds: 38 })
    }
    add("sw-1", "swahili")
    add("en-1", "english")
    add("sw-2", "swahili")
    add("en-2", "english")
    add("sw-3", "swahili")

    expect(store.releaseOldestForLanguage("swahili", 2)).toBe(2)
    expect(store.getEntries().map((e) => e.videoId)).toEqual([
      "en-1",
      "en-2",
      "sw-3",
    ])
  })

  it("releases nothing, and keeps the version, for a language with no entries", () => {
    const { store } = makeStore()
    store.add({
      videoId: "en-1",
      languageSlug: "english",
      startSeconds: 10,
      endSeconds: 38,
    })
    const version = store.getVersion()
    expect(store.releaseOldestForLanguage("swahili", 5)).toBe(0)
    expect(store.releaseOldestForLanguage("english", 0)).toBe(0)
    expect(store.getEntries()).toHaveLength(1)
    expect(store.getVersion()).toBe(version)
  })

  it("persists the release", async () => {
    const { store, storage } = makeStore()
    await store.hydrate()
    store.add({
      videoId: "en-1",
      languageSlug: "english",
      startSeconds: 10,
      endSeconds: 38,
    })
    await store.flushNow()
    store.releaseOldestForLanguage("english", 1)
    await jest.advanceTimersByTimeAsync(CLIP_RECORD_WRITE_INTERVAL_MS)
    expect(storedEntries(storage)).toEqual([])
  })
})

describe("writes (KTD15, KTD22)", () => {
  function addClip(store: ReturnType<typeof makeStore>["store"], i: number) {
    store.add({
      videoId: `video-${i}`,
      languageSlug: "english",
      startSeconds: 10,
      endSeconds: 38,
    })
  }

  it("writes ten adds within 5 s as one storage write", async () => {
    const { store, storage } = makeStore()
    await store.hydrate()
    for (let i = 0; i < 10; i += 1) {
      addClip(store, i)
      await jest.advanceTimersByTimeAsync(400)
    }
    expect(storage.setItem).not.toHaveBeenCalled()

    await jest.advanceTimersByTimeAsync(CLIP_RECORD_WRITE_INTERVAL_MS)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(storedEntries(storage)).toHaveLength(10)
  })

  it("never writes twice within 5 s", async () => {
    const { store, storage } = makeStore()
    const writeTimes: number[] = []
    storage.setItem.mockImplementation(async (key, value) => {
      writeTimes.push(Date.now())
      storage.items.set(key, value)
    })
    await store.hydrate()
    for (let i = 0; i < 40; i += 1) {
      addClip(store, i)
      await jest.advanceTimersByTimeAsync(500)
    }
    expect(writeTimes.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < writeTimes.length; i += 1) {
      expect(writeTimes[i] - writeTimes[i - 1]).toBeGreaterThanOrEqual(
        CLIP_RECORD_WRITE_INTERVAL_MS,
      )
    }
  })

  it("starts no write while a gesture is active, and writes once it settles", async () => {
    const { store, storage } = makeStore()
    await store.hydrate()
    addClip(store, 1)
    store.setGestureActive(true)
    await jest.advanceTimersByTimeAsync(CLIP_RECORD_WRITE_INTERVAL_MS * 4)
    addClip(store, 2)
    await jest.advanceTimersByTimeAsync(CLIP_RECORD_WRITE_INTERVAL_MS * 4)
    expect(storage.setItem).not.toHaveBeenCalled()

    store.setGestureActive(false)
    await jest.advanceTimersByTimeAsync(0)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(storedEntries(storage)).toHaveLength(2)
  })

  it("does not write early when a gesture settles before the interval ends", async () => {
    const { store, storage } = makeStore()
    await store.hydrate()
    addClip(store, 1)
    store.setGestureActive(true)
    await jest.advanceTimersByTimeAsync(1000)
    store.setGestureActive(false)
    await jest.advanceTimersByTimeAsync(0)
    expect(storage.setItem).not.toHaveBeenCalled()

    await jest.advanceTimersByTimeAsync(CLIP_RECORD_WRITE_INTERVAL_MS)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
  })

  it("writes at once on a background flush, even during a gesture", async () => {
    const { store, storage } = makeStore()
    await store.hydrate()
    addClip(store, 1)
    store.setGestureActive(true)
    await store.flushNow()
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(storedEntries(storage)).toHaveLength(1)

    // The flush took the pending write; nothing is left to write.
    store.setGestureActive(false)
    await jest.advanceTimersByTimeAsync(CLIP_RECORD_WRITE_INTERVAL_MS * 2)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
  })

  it("does not write on a background flush when nothing changed", async () => {
    const { store, storage } = makeStore()
    await store.hydrate()
    await store.flushNow()
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it("starts no write before the stored read lands, so no stored entry is lost", async () => {
    const { store, storage } = makeStore()
    const read = deferred<string | null>()
    storage.getItem.mockReturnValueOnce(read.promise)
    void store.hydrate()

    addClip(store, 1)
    await jest.advanceTimersByTimeAsync(CLIP_RECORD_WRITE_INTERVAL_MS * 3)
    expect(storage.setItem).not.toHaveBeenCalled()

    read.resolve(seedBlob([entry("video-old", 10, { shownAt: T0 - DAY_MS })]))
    await jest.advanceTimersByTimeAsync(0)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(storedEntries(storage).map((e) => e.videoId)).toEqual([
      "video-old",
      "video-1",
    ])
  })

  it("reads storage first when a write comes before any hydrate", async () => {
    const { store, storage } = makeStore(
      seedBlob([entry("video-old", 10, { shownAt: T0 - DAY_MS })]),
    )
    addClip(store, 1)
    await jest.advanceTimersByTimeAsync(CLIP_RECORD_WRITE_INTERVAL_MS)
    expect(storage.getItem).toHaveBeenCalledTimes(1)
    expect(storedEntries(storage).map((e) => e.videoId)).toEqual([
      "video-old",
      "video-1",
    ])
  })

  it("keeps a storage error on write away from the caller", async () => {
    const { store, storage } = makeStore()
    await store.hydrate()
    storage.setItem.mockRejectedValueOnce(new Error("disk full"))
    storage.setItem.mockImplementationOnce(() => {
      throw new Error("native module missing")
    })

    addClip(store, 1)
    await jest.advanceTimersByTimeAsync(CLIP_RECORD_WRITE_INTERVAL_MS)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    await expect(store.flushNow()).resolves.toBeUndefined()
    expect(storage.setItem).toHaveBeenCalledTimes(2)
    expect(store.getEntries()).toHaveLength(1)

    // Memory stays authoritative, and the next flush writes it.
    await store.flushNow()
    expect(storedEntries(storage)).toHaveLength(1)
  })
})

describe("last visit date (KTD17)", () => {
  it("returns the previous visit date and stores today's", async () => {
    const { store, storage, clock } = makeStore(
      seedBlob([], localDateKey(new Date(T0 - DAY_MS))),
    )
    await store.hydrate()
    expect(store.getLastVisitDate()).toBe(localDateKey(new Date(T0 - DAY_MS)))

    expect(store.recordVisit()).toBe(localDateKey(new Date(T0 - DAY_MS)))
    expect(store.getLastVisitDate()).toBe(localDateKey(new Date(T0)))
    await store.flushNow()
    const raw = storage.items.get(CLIP_RECORD_STORAGE_KEY) ?? null
    expect(parseStoredClipRecord(raw, new Date(clock.now)).lastVisitDate).toBe(
      localDateKey(new Date(T0)),
    )
  })

  it("keeps the last visit date after every entry expires", async () => {
    const { store } = makeStore(
      seedBlob(
        [entry("video-a", 10, { shownAt: T0 - 30 * DAY_MS })],
        "2026-08-26",
      ),
    )
    await store.hydrate()
    expect(store.getEntries()).toEqual([])
    expect(store.getLastVisitDate()).toBe("2026-08-26")
  })

  it("does not write again for a second visit on the same day", async () => {
    const { store, storage } = makeStore()
    await store.hydrate()
    expect(store.recordVisit()).toBeNull()
    await store.flushNow()
    expect(store.recordVisit()).toBe(localDateKey(new Date(T0)))
    await store.flushNow()
    expect(storage.setItem).toHaveBeenCalledTimes(1)
  })

  it("uses the device's local calendar date", () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05")
    expect(localDateKey(new Date(2026, 11, 31, 0, 1))).toBe("2026-12-31")
  })

  it("counts whole days between two dates", () => {
    expect(daysBetweenDateKeys("2026-09-24", "2026-09-25")).toBe(1)
    expect(daysBetweenDateKeys("2026-09-25", "2026-09-25")).toBe(0)
    expect(daysBetweenDateKeys("2026-02-28", "2026-03-01")).toBe(1)
    expect(daysBetweenDateKeys("2025-12-31", "2026-01-30")).toBe(30)
    // A daylight-saving change inside the span still counts calendar days.
    expect(daysBetweenDateKeys("2026-03-01", "2026-04-01")).toBe(31)
    expect(daysBetweenDateKeys("2026-9-25", "2026-09-26")).toBeNull()
    expect(daysBetweenDateKeys("2026-02-30", "2026-03-01")).toBeNull()
  })
})

import {
  WATCH_PROGRESS_QUEUE_STORAGE_KEY,
  enqueueProgressWrite,
} from "../queue"
import {
  WATCH_PROGRESS_SNAPSHOT_STORAGE_KEY,
  serializeProgressSnapshot,
} from "../snapshot"
import {
  bufferProgressIntent,
  getProgressEntry,
  getProgressSnapshot,
  peekProgressIntents,
  resetToSignedOut,
  type WatchProgressEntry,
} from "../store"
import { PROGRESS_BATCH_INTERVAL_MS } from "../syncPlan"
import { createProgressSync, type ProgressSyncDeps } from "../sync"

const NOW = Date.parse("2026-08-04T00:00:00.000Z")

function entry(
  videoId: string,
  overrides: Partial<WatchProgressEntry> = {},
): WatchProgressEntry {
  return {
    videoId,
    languageSlug: null,
    positionSeconds: 30,
    durationSeconds: 100,
    completed: false,
    updatedAt: "2026-08-03T00:00:00.000Z",
    ...overrides,
  }
}

function memoryStorage(seed: Record<string, string> = {}) {
  const backing = new Map(Object.entries(seed))
  return {
    backing,
    getItem: jest.fn(async (key: string) => backing.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      backing.set(key, value)
    }),
    removeItem: jest.fn(async (key: string) => {
      backing.delete(key)
    }),
  }
}

function buildSync(overrides: Partial<ProgressSyncDeps> = {}) {
  const storage = memoryStorage()
  const deps: ProgressSyncDeps = {
    getAccountId: () => "user-1",
    fetchEntries: jest.fn(async () => [entry("video-1")]),
    sendUpserts: jest.fn(async () => {}),
    storage,
    now: () => NOW,
    ...overrides,
  }
  return { sync: createProgressSync(deps), deps, storage: deps.storage }
}

beforeEach(() => {
  resetToSignedOut()
})

describe("hydrateFromSnapshot", () => {
  it("paints the signed-in account's persisted snapshot", async () => {
    const blob = serializeProgressSnapshot(
      "user-1",
      [entry("video-1")],
      new Date(NOW),
    )
    const { sync } = buildSync({
      storage: memoryStorage({
        [WATCH_PROGRESS_SNAPSHOT_STORAGE_KEY]: blob ?? "",
      }),
    })

    await sync.hydrateFromSnapshot()

    expect(getProgressEntry("video-1")).toBeDefined()
    expect(getProgressSnapshot().accountId).toBe("user-1")
  })

  it("never paints another account's snapshot", async () => {
    const blob = serializeProgressSnapshot(
      "user-2",
      [entry("video-1")],
      new Date(NOW),
    )
    const { sync } = buildSync({
      storage: memoryStorage({
        [WATCH_PROGRESS_SNAPSHOT_STORAGE_KEY]: blob ?? "",
      }),
    })

    await sync.hydrateFromSnapshot()

    expect(getProgressEntry("video-1")).toBeUndefined()
  })

  it("does nothing signed out", async () => {
    const { sync } = buildSync({ getAccountId: () => null })
    await sync.hydrateFromSnapshot()
    expect(getProgressSnapshot().accountId).toBeNull()
  })
})

describe("hydrateFromServer (fail-open, R11/AE5)", () => {
  it("hydrates the store and persists the snapshot on success", async () => {
    const { sync, storage } = buildSync()

    await sync.hydrateFromServer()

    expect(getProgressEntry("video-1")).toBeDefined()
    expect(storage.setItem).toHaveBeenCalledWith(
      WATCH_PROGRESS_SNAPSHOT_STORAGE_KEY,
      expect.stringContaining("video-1"),
    )
  })

  it("reuses last-good on failure so bars never blank on a blip", async () => {
    const fetchEntries = jest
      .fn<Promise<WatchProgressEntry[]>, []>()
      .mockResolvedValueOnce([entry("video-1")])
      .mockRejectedValueOnce(new Error("network down"))
    const { sync } = buildSync({ fetchEntries })

    await sync.hydrateFromServer()
    await sync.hydrateFromServer()

    expect(getProgressEntry("video-1")).toBeDefined()
  })

  it("leaves the app fully usable when the first read fails (no entries, no throw)", async () => {
    const { sync } = buildSync({
      fetchEntries: jest.fn(async () => {
        throw new Error("surface down")
      }),
    })

    await expect(sync.hydrateFromServer()).resolves.toBeUndefined()
    expect(getProgressSnapshot().entries.size).toBe(0)
  })

  it("does not hydrate an account that signed out mid-fetch", async () => {
    let accountId: string | null = "user-1"
    const { sync } = buildSync({
      getAccountId: () => accountId,
      fetchEntries: jest.fn(async () => {
        accountId = null
        return [entry("video-1")]
      }),
    })

    await sync.hydrateFromServer()

    expect(getProgressSnapshot().accountId).toBeNull()
  })
})

describe("flushQueue (R7)", () => {
  function queueBlobFor(accountId: string) {
    const queue = enqueueProgressWrite(null, accountId, {
      videoSlug: "birth-of-jesus",
      languageSlug: null,
      positionSeconds: 41,
      durationSeconds: 100,
      recordedAt: "2026-08-03T23:00:00.000Z",
    })
    return JSON.stringify({ version: 1, ...queue })
  }

  it("sends the matching account's queue then clears it", async () => {
    const storage = memoryStorage({
      [WATCH_PROGRESS_QUEUE_STORAGE_KEY]: queueBlobFor("user-1"),
    })
    const { sync, deps } = buildSync({ storage })

    await sync.flushQueue()

    expect(deps.sendUpserts).toHaveBeenCalledWith([
      expect.objectContaining({ videoSlug: "birth-of-jesus" }),
    ])
    expect(storage.backing.has(WATCH_PROGRESS_QUEUE_STORAGE_KEY)).toBe(false)
  })

  it("discards a mismatched account's queue without sending", async () => {
    const storage = memoryStorage({
      [WATCH_PROGRESS_QUEUE_STORAGE_KEY]: queueBlobFor("user-2"),
    })
    const { sync, deps } = buildSync({ storage })

    await sync.flushQueue()

    expect(deps.sendUpserts).not.toHaveBeenCalled()
    expect(storage.backing.has(WATCH_PROGRESS_QUEUE_STORAGE_KEY)).toBe(false)
  })

  it("retains the queue when the send fails", async () => {
    const storage = memoryStorage({
      [WATCH_PROGRESS_QUEUE_STORAGE_KEY]: queueBlobFor("user-1"),
    })
    const { sync } = buildSync({
      storage,
      sendUpserts: jest.fn(async () => {
        throw new Error("offline again")
      }),
    })

    await sync.flushQueue()

    expect(storage.backing.has(WATCH_PROGRESS_QUEUE_STORAGE_KEY)).toBe(true)
  })
})

describe("drainIntents (KTD5 cadence)", () => {
  const intent = {
    videoId: "video-1",
    languageSlug: null,
    positionSeconds: 12,
    durationSeconds: 100,
    recordedAt: "2026-08-04T00:00:00.000Z",
  }

  it("sends buffered intents and empties the buffer", async () => {
    bufferProgressIntent(intent)
    const { sync, deps } = buildSync()

    await sync.drainIntents({ forced: false })

    expect(deps.sendUpserts).toHaveBeenCalledWith([
      expect.objectContaining({ videoId: "video-1" }),
    ])
    expect(peekProgressIntents()).toEqual([])
  })

  it("throttles unforced sends to one per window", async () => {
    let currentTime = NOW
    const { sync, deps } = buildSync({ now: () => currentTime })

    bufferProgressIntent(intent)
    await sync.drainIntents({ forced: false })
    currentTime += 1_000
    bufferProgressIntent({ ...intent, positionSeconds: 14 })
    await sync.drainIntents({ forced: false })

    expect(deps.sendUpserts).toHaveBeenCalledTimes(1)

    currentTime += PROGRESS_BATCH_INTERVAL_MS
    await sync.drainIntents({ forced: false })
    expect(deps.sendUpserts).toHaveBeenCalledTimes(2)
  })

  it("a forced drain sends immediately inside the window", async () => {
    let currentTime = NOW
    const { sync, deps } = buildSync({ now: () => currentTime })

    bufferProgressIntent(intent)
    await sync.drainIntents({ forced: false })
    currentTime += 1_000
    bufferProgressIntent({ ...intent, positionSeconds: 14 })
    await sync.drainIntents({ forced: true })

    expect(deps.sendUpserts).toHaveBeenCalledTimes(2)
  })

  it("restores intents on a failed send", async () => {
    bufferProgressIntent(intent)
    const { sync } = buildSync({
      sendUpserts: jest.fn(async () => {
        throw new Error("send failed")
      }),
    })

    await sync.drainIntents({ forced: true })

    expect(peekProgressIntents()).toHaveLength(1)
  })

  it("never sends signed out (R10)", async () => {
    bufferProgressIntent(intent)
    const { sync, deps } = buildSync({ getAccountId: () => null })

    await sync.drainIntents({ forced: true })

    expect(deps.sendUpserts).not.toHaveBeenCalled()
  })
})

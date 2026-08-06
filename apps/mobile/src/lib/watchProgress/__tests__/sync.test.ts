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
  hydrateProgress,
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
    sendUpserts: jest.fn(async () => ({ acceptedCount: 1 })),
    sendClear: jest.fn(async () => {}),
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

  it("persists a failed batch to the durable queue, not just memory", async () => {
    // The in-memory buffer dies with the process. A downloaded film watched
    // on a flaky connection must survive an app kill, which is exactly what
    // R7's queue is for — the queue is the FAILURE path, not a source-kind
    // path, so this also covers watching a download while fully online.
    bufferProgressIntent(intent)
    const { sync, storage } = buildSync({
      sendUpserts: jest.fn(async () => {
        throw new Error("offline")
      }),
    })

    await sync.drainIntents({ forced: true })

    const raw = await storage.getItem(WATCH_PROGRESS_QUEUE_STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string)).toMatchObject({
      accountId: "user-1",
      writes: [expect.objectContaining({ videoId: "video-1" })],
    })
  })

  it("drains the queued backlog once a send succeeds again", async () => {
    // R7's "flush when connectivity returns": without this the backlog waits
    // for the next sign-in, so a user who never signs out never syncs.
    const { sync, deps, storage } = buildSync()
    await storage.setItem(
      WATCH_PROGRESS_QUEUE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        accountId: "user-1",
        writes: [{ ...intent, videoId: "video-backlog" }],
      }),
    )
    bufferProgressIntent(intent)

    await sync.drainIntents({ forced: true })

    const sent = (deps.sendUpserts as jest.Mock).mock.calls.flatMap(
      (call) => call[0] as Array<{ videoId?: string }>,
    )
    expect(sent.map((write) => write.videoId)).toEqual(
      expect.arrayContaining(["video-1", "video-backlog"]),
    )
    expect(await storage.getItem(WATCH_PROGRESS_QUEUE_STORAGE_KEY)).toBeNull()
  })

  it("does NOT restore failed intents when the account changed mid-send", async () => {
    // The leak: the buffer is shared and untagged, so intents restored after
    // a sign-out/switch flush under the NEXT account's identity. Admin cannot
    // catch it — it derives the user from the JWT, which is genuinely theirs.
    let accountId: string | null = "user-1"
    bufferProgressIntent(intent)
    const { sync, storage } = buildSync({
      getAccountId: () => accountId,
      sendUpserts: jest.fn(async () => {
        accountId = "user-2"
        throw new Error("network")
      }),
    })

    await sync.drainIntents({ forced: true })

    expect(peekProgressIntents()).toEqual([])
    // And nothing was persisted under the new account either.
    expect(await storage.getItem(WATCH_PROGRESS_QUEUE_STORAGE_KEY)).toBeNull()
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

  it("a failed send keeps the write, in the queue rather than the buffer", async () => {
    // Contract change: failures used to re-buffer in memory, which was lost
    // on app kill and untagged by account. They now persist to the durable,
    // account-bound queue instead — same guarantee, stronger medium.
    bufferProgressIntent(intent)
    const { sync, storage } = buildSync({
      sendUpserts: jest.fn(async () => {
        throw new Error("send failed")
      }),
    })

    await sync.drainIntents({ forced: true })

    expect(peekProgressIntents()).toHaveLength(0)
    expect(await storage.getItem(WATCH_PROGRESS_QUEUE_STORAGE_KEY)).toContain(
      "video-1",
    )
  })

  it("never sends signed out (R10)", async () => {
    bufferProgressIntent(intent)
    const { sync, deps } = buildSync({ getAccountId: () => null })

    await sync.drainIntents({ forced: true })

    expect(deps.sendUpserts).not.toHaveBeenCalled()
  })
})

describe("clearEntry (R16 optimistic clear)", () => {
  it("removes the entry immediately and calls the server clear", async () => {
    const { sync, deps } = buildSync()
    hydrateProgress({
      accountId: "user-1",
      entries: [entry("video-1"), entry("video-2")],
    })

    await sync.clearEntry("video-1")

    expect(getProgressEntry("video-1")).toBeUndefined()
    expect(getProgressEntry("video-2")).toBeDefined()
    expect(deps.sendClear).toHaveBeenCalledWith("video-1")
  })

  it("re-hydrates on a failed clear so the bar reappears rather than vanishing", async () => {
    const fetchEntries = jest.fn(async () => [entry("video-1")])
    const { sync } = buildSync({
      fetchEntries,
      sendClear: jest.fn(async () => {
        throw new Error("clear failed")
      }),
    })
    hydrateProgress({ accountId: "user-1", entries: [entry("video-1")] })

    await sync.clearEntry("video-1")

    expect(fetchEntries).toHaveBeenCalled()
    expect(getProgressEntry("video-1")).toBeDefined()
  })

  it("does nothing signed out", async () => {
    const { sync, deps } = buildSync({ getAccountId: () => null })
    await sync.clearEntry("video-1")
    expect(deps.sendClear).not.toHaveBeenCalled()
  })
})

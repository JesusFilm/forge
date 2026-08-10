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
    sendUpserts: jest.fn(async () => ({ acceptedCount: 1 })),
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

  it("sends the queued backlog BEFORE the fresh batch", async () => {
    // Oldest-first. Sending the backlog second makes the server's staleness
    // guard reject it — correctly, but that loses the write whenever a
    // skewed clock clamps both to the same instant, and fires a false
    // writes_not_applied on every recovery.
    const { sync, deps, storage } = buildSync()
    await storage.setItem(
      WATCH_PROGRESS_QUEUE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        accountId: "user-1",
        writes: [{ ...intent, videoId: "video-old" }],
      }),
    )
    bufferProgressIntent({ ...intent, videoId: "video-fresh" })

    await sync.drainIntents({ forced: true })

    const order = (deps.sendUpserts as jest.Mock).mock.calls.map(
      (call) => (call[0] as Array<{ videoId?: string }>)[0]?.videoId,
    )
    expect(order).toEqual(["video-old", "video-fresh"])
  })

  it("a concurrent failure's writes survive an in-flight flush", async () => {
    // The queue is one storage cell that persist and flush both
    // read-modify-write. Clearing the whole key on a successful send would
    // discard anything persisted while that send was in the air.
    const { sync, storage } = buildSync({
      sendUpserts: jest.fn(async (entries) => {
        if (entries.some((write) => write.videoId === "video-queued")) {
          // While the backlog send is in flight, a fresh batch fails and
          // persists. Serialization must not let that write be lost.
          bufferProgressIntent({ ...intent, videoId: "video-late" })
        }
        return { acceptedCount: entries.length }
      }),
    })
    await storage.setItem(
      WATCH_PROGRESS_QUEUE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        accountId: "user-1",
        writes: [
          { ...intent, videoId: "video-queued" },
          { ...intent, videoId: "video-untouched" },
        ],
      }),
    )

    await sync.flushQueue()

    // Both were sent, so the key is gone — not because it was blanket-cleared.
    expect(await storage.getItem(WATCH_PROGRESS_QUEUE_STORAGE_KEY)).toBeNull()
  })

  it("re-buffers rather than losing the batch when storage rejects", async () => {
    // persistFailedWrites is the ONLY retention path now, so a wedged
    // AsyncStorage would otherwise drop the batch silently.
    const storage = memoryStorage()
    storage.setItem = jest.fn(
      async (_key: string, _value: string): Promise<void> => {
        throw new Error("SQLITE_FULL")
      },
    )
    bufferProgressIntent(intent)
    const { sync } = buildSync({
      storage,
      sendUpserts: jest.fn(async () => {
        throw new Error("offline")
      }),
    })

    await sync.drainIntents({ forced: true })

    expect(peekProgressIntents()).toEqual([
      expect.objectContaining({ videoId: "video-1" }),
    ])
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

describe("account boundary", () => {
  it("never reuses one account's last-good for another account", async () => {
    // The fail-open path is the leak: sign in as B, let B's first server read
    // fail, and an untagged cache paints A's history under B's id (R10).
    let accountId = "user-1"
    const fetchEntries = jest
      .fn<Promise<WatchProgressEntry[]>, []>()
      .mockResolvedValueOnce([entry("video-a")])
      .mockRejectedValueOnce(new Error("offline"))
    const { sync } = buildSync({
      getAccountId: () => accountId,
      fetchEntries,
    })

    await sync.hydrateFromServer()
    expect(getProgressSnapshot().entries.size).toBe(1)

    accountId = "user-2"
    await sync.hydrateFromServer()

    expect(getProgressSnapshot().accountId).toBe("user-2")
    expect(getProgressSnapshot().entries.size).toBe(0)
  })

  it("still reuses last-good for the SAME account on a blip", async () => {
    // The anti-vacuous companion: the fix must not disable fail-open.
    const fetchEntries = jest
      .fn<Promise<WatchProgressEntry[]>, []>()
      .mockResolvedValueOnce([entry("video-a")])
      .mockRejectedValueOnce(new Error("blip"))
    const { sync } = buildSync({ fetchEntries })

    await sync.hydrateFromServer()
    await sync.hydrateFromServer()

    expect(getProgressSnapshot().entries.size).toBe(1)
  })

  it("keeps hydrating when the snapshot write rejects", async () => {
    // Unguarded, this rejects hydrateFromServer inside a fire-and-forget
    // chain and the flush that follows it never runs.
    const storage = memoryStorage()
    storage.setItem = jest.fn(
      async (_key: string, _value: string): Promise<void> => {
        throw new Error("SQLITE_FULL")
      },
    )
    const { sync } = buildSync({ storage })

    await expect(sync.hydrateFromServer()).resolves.toBeUndefined()
    expect(getProgressSnapshot().entries.size).toBe(1)
  })
})

describe("queue serialization (onQueue)", () => {
  it("makes a second queue operation wait for the first to finish", async () => {
    // The mutex exists for a real race: the foreground flush and the
    // poll-driven drain are both fire-and-forget. Every other test awaits
    // each call in turn, so none of them would notice its removal — this one
    // starts two operations that genuinely overlap.
    const storage = memoryStorage()
    let reads = 0
    let releaseFirstRead: () => void = () => {}
    const firstRead = new Promise<void>((resolve) => {
      releaseFirstRead = resolve
    })
    storage.getItem = jest.fn(async (key: string) => {
      reads += 1
      if (reads === 1) await firstRead
      return storage.backing.get(key) ?? null
    })
    const { sync } = buildSync({ storage })

    const first = sync.flushQueue()
    const second = sync.flushQueue()
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The first operation still holds the lock, so the second has not read.
    expect(reads).toBe(1)

    releaseFirstRead()
    await Promise.all([first, second])
    expect(reads).toBe(2)
  })
})

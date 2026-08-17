import { _resetStorageForTests, getStorage } from "../safeStorage"
import {
  MY_LIST_STORAGE_KEY,
  toggleMyList,
  type MyListEntry,
} from "../myList/myList"
import {
  ANONYMOUS_STATE_KEYS,
  LOCAL_USER_STORAGE_KEY,
  UNOWNED_LOCAL_USER,
  clearAnonymousWatchState,
  decideMergeAction,
  mergeContinueWatching,
  parseLocalUserMarker,
  promoteAnonymousStateToAccount,
  readLocalUserMarker,
  releaseLocalUserOnSignOut,
  writeLocalUserMarker,
  type AccountMergePayload,
} from "./anonymousMerge"
import {
  CONTINUE_WATCHING_STORAGE_KEY,
  PENDING_COMPLETIONS_STORAGE_KEY,
  saveResumeSnapshot,
  type ContinueWatchingEntry,
  type PendingCompletion,
} from "../watchEvents/continueWatching"
import {
  QUEUE_STORAGE_KEY,
  VIEWER_ID_STORAGE_KEY,
  readWatchEventQueue,
  type QueuedWatchEvent,
} from "../watchEvents/watchEvents"

// getStorage() warns once per reset when AsyncStorage isn't linked (always,
// under jest). Silence it so the per-test reset doesn't drown the run.
beforeAll(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {})
})

beforeEach(() => {
  _resetStorageForTests()
  jest.clearAllMocks()
})

const entry = (
  videoId: string,
  overrides: Partial<ContinueWatchingEntry> = {},
): ContinueWatchingEntry => ({
  videoId,
  slug: `${videoId}-slug`,
  title: videoId,
  imageUrl: null,
  positionSeconds: 100,
  durationSeconds: 1000,
  progress: 0.1,
  updatedAt: "2026-08-10T00:00:00.000Z",
  ...overrides,
})

const queued = (videoId: string): QueuedWatchEvent => ({
  videoId,
  videoDubId: null,
  positionSeconds: 120,
  durationSeconds: 1000,
  progress: 0.12,
  requestSessionId: "viewer-anon",
  queuedAt: "2026-08-10T00:00:00.000Z",
})

async function seedAnonymousState(input: {
  viewerId?: string
  entries?: ContinueWatchingEntry[]
  events?: QueuedWatchEvent[]
  completions?: PendingCompletion[]
  myList?: MyListEntry[]
}): Promise<void> {
  const storage = getStorage()
  if (input.viewerId != null) {
    await storage.setItem(VIEWER_ID_STORAGE_KEY, input.viewerId)
  }
  if (input.myList != null) {
    await storage.setItem(MY_LIST_STORAGE_KEY, JSON.stringify(input.myList))
  }
  if (input.entries != null) {
    await storage.setItem(
      CONTINUE_WATCHING_STORAGE_KEY,
      JSON.stringify(input.entries),
    )
  }
  if (input.completions != null) {
    await storage.setItem(
      PENDING_COMPLETIONS_STORAGE_KEY,
      JSON.stringify(input.completions),
    )
  }
  if (input.events != null) {
    await storage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(input.events))
  }
}

async function readAllAnonymousKeys(): Promise<(string | null)[]> {
  const storage = getStorage()
  return Promise.all(ANONYMOUS_STATE_KEYS.map((key) => storage.getItem(key)))
}

describe("decideMergeAction", () => {
  it("promotes unowned local state", () => {
    expect(decideMergeAction({ userId: null }, "user-a")).toBe("promote")
  })

  it("skips when this account already merged on this device", () => {
    expect(decideMergeAction({ userId: "user-a" }, "user-a")).toBe("skip")
  })

  it("resets when the local state belongs to a different account", () => {
    expect(decideMergeAction({ userId: "user-a" }, "user-b")).toBe("reset")
  })
})

describe("parseLocalUserMarker", () => {
  it.each([
    ["null", null],
    ["empty string", ""],
    ["not json", "{{{"],
    ["a json array", "[]"],
    ["json null", "null"],
    ["an object without userId", '{"other":1}'],
    ["a non-string userId", '{"userId":42}'],
    ["an empty userId", '{"userId":""}'],
  ])("reads %s as unowned", (_label, raw) => {
    expect(parseLocalUserMarker(raw)).toEqual(UNOWNED_LOCAL_USER)
  })

  it("reads a stored user id", () => {
    expect(parseLocalUserMarker('{"userId":"user-a"}')).toEqual({
      userId: "user-a",
    })
  })
})

describe("mergeContinueWatching", () => {
  it("keeps the furthest progress per videoId", () => {
    const merged = mergeContinueWatching(
      [entry("v1", { progress: 0.2, positionSeconds: 200 })],
      [entry("v1", { progress: 0.7, positionSeconds: 700 })],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]!.progress).toBe(0.7)
  })

  it("does not let a shorter position win", () => {
    const merged = mergeContinueWatching(
      [entry("v1", { progress: 0.7, positionSeconds: 700 })],
      [entry("v1", { progress: 0.2, positionSeconds: 200 })],
    )
    expect(merged[0]!.progress).toBe(0.7)
  })

  it("falls back to absolute seconds when neither side knows duration", () => {
    const merged = mergeContinueWatching(
      [
        entry("v1", {
          progress: null,
          durationSeconds: null,
          positionSeconds: 2400,
        }),
      ],
      [
        entry("v1", {
          progress: null,
          durationSeconds: null,
          positionSeconds: 30,
        }),
      ],
    )
    expect(merged[0]!.positionSeconds).toBe(2400)
  })

  it("keeps the first side on a tie, so the account's own row wins", () => {
    const merged = mergeContinueWatching(
      [entry("v1", { updatedAt: "server" })],
      [entry("v1", { updatedAt: "local" })],
    )
    expect(merged[0]!.updatedAt).toBe("server")
  })

  it("keeps distinct videos side by side", () => {
    const merged = mergeContinueWatching([entry("v1")], [entry("v2")])
    expect(merged.map((e) => e.videoId).sort()).toEqual(["v1", "v2"])
  })
})

describe("promoteAnonymousStateToAccount", () => {
  it("hands the anonymous buckets to the server and claims them for the account", async () => {
    await seedAnonymousState({
      viewerId: "viewer-anon",
      entries: [entry("v1")],
    })
    const submitProgress = jest.fn<Promise<boolean>, [AccountMergePayload]>(
      async () => true,
    )

    const outcome = await promoteAnonymousStateToAccount({
      userId: "user-a",
      submitProgress,
    })

    expect(outcome).toEqual({
      status: "promoted",
      eventsSubmitted: 0,
      eventsRetained: 0,
    })
    expect(submitProgress).toHaveBeenCalledTimes(1)
    const payload = submitProgress.mock.calls[0]![0]
    expect(payload.claimedUserId).toBe("user-a")
    expect(payload.viewerId).toBe("viewer-anon")
    expect(payload.continueWatching.map((e) => e.videoId)).toEqual(["v1"])
    expect(await readLocalUserMarker()).toEqual({ userId: "user-a" })
  })

  it("drains the watch-event queue through the shared flush", async () => {
    await seedAnonymousState({
      viewerId: "viewer-anon",
      events: [queued("v1"), queued("v2")],
    })
    const submitWatchEvent = jest.fn(async () => true)

    const outcome = await promoteAnonymousStateToAccount({
      userId: "user-a",
      submitProgress: async () => true,
      submitWatchEvent,
    })

    expect(outcome).toEqual({
      status: "promoted",
      eventsSubmitted: 2,
      eventsRetained: 0,
    })
    expect(await readWatchEventQueue()).toEqual([])
  })

  it("retains events the server refused, for a later flush", async () => {
    await seedAnonymousState({
      viewerId: "viewer-anon",
      events: [queued("v1"), queued("v2")],
    })

    const outcome = await promoteAnonymousStateToAccount({
      userId: "user-a",
      submitProgress: async () => true,
      submitWatchEvent: async (event) => event.videoId === "v1",
    })

    expect(outcome).toEqual({
      status: "promoted",
      eventsSubmitted: 1,
      eventsRetained: 1,
    })
    expect((await readWatchEventQueue()).map((e) => e.videoId)).toEqual(["v2"])
  })

  it("leaves the queue for later when no event submitter is supplied", async () => {
    await seedAnonymousState({
      viewerId: "viewer-anon",
      events: [queued("v1")],
    })

    await promoteAnonymousStateToAccount({
      userId: "user-a",
      submitProgress: async () => true,
    })

    expect((await readWatchEventQueue()).map((e) => e.videoId)).toEqual(["v1"])
  })

  it("promotes exactly once per account", async () => {
    await seedAnonymousState({
      viewerId: "viewer-anon",
      entries: [entry("v1")],
    })
    const submitProgress = jest.fn(async () => true)

    await promoteAnonymousStateToAccount({ userId: "user-a", submitProgress })
    const second = await promoteAnonymousStateToAccount({
      userId: "user-a",
      submitProgress,
    })

    expect(second).toEqual({ status: "already_merged" })
    expect(submitProgress).toHaveBeenCalledTimes(1)
  })

  it("reports nothing-to-promote on a fresh install but still claims the device", async () => {
    const submitProgress = jest.fn(async () => true)

    const outcome = await promoteAnonymousStateToAccount({
      userId: "user-a",
      submitProgress,
    })

    expect(outcome).toEqual({ status: "nothing_to_promote" })
    expect(submitProgress).not.toHaveBeenCalled()
    expect(await readLocalUserMarker()).toEqual({ userId: "user-a" })
  })

  it("keeps everything for a retry when the server refuses the payload", async () => {
    await seedAnonymousState({
      viewerId: "viewer-anon",
      entries: [entry("v1")],
    })

    const outcome = await promoteAnonymousStateToAccount({
      userId: "user-a",
      submitProgress: async () => false,
    })

    expect(outcome).toEqual({ status: "failed" })
    // Marker unmoved and buckets intact — a later sign-in retries the promotion
    // rather than marking unpromoted history as done.
    expect(await readLocalUserMarker()).toEqual(UNOWNED_LOCAL_USER)
    expect(await getStorage().getItem(VIEWER_ID_STORAGE_KEY)).toBe(
      "viewer-anon",
    )

    const retry = await promoteAnonymousStateToAccount({
      userId: "user-a",
      submitProgress: async () => true,
    })
    expect(retry.status).toBe("promoted")
  })

  it("never throws when a submitter rejects", async () => {
    await seedAnonymousState({ viewerId: "viewer-anon" })

    await expect(
      promoteAnonymousStateToAccount({
        userId: "user-a",
        submitProgress: async () => {
          throw new Error("network")
        },
      }),
    ).resolves.toEqual({ status: "failed" })
  })
})

// ── The property this module exists for ─────────────────────────────────────
//
// Falsify by relaxing `decideMergeAction`'s reset branch to "promote", or by
// dropping the wipe from the reset path: both of these go red.
describe("account isolation between family members", () => {
  it("does not hand user A's buckets to user B when sign-out never ran", async () => {
    await seedAnonymousState({
      viewerId: "viewer-anon",
      entries: [entry("a-only")],
      events: [queued("a-only")],
      completions: [
        {
          videoId: "v1",
          slug: "v1-slug",
          positionSeconds: 1000,
          durationSeconds: 1000,
          updatedAt: "2026-08-10T00:00:00.000Z",
        },
      ],
    })
    const submitA = jest.fn(async () => true)
    await promoteAnonymousStateToAccount({
      userId: "user-a",
      submitProgress: submitA,
    })

    // No sign-out: force quit, storage failure, a token wiped from under the
    // app. B signs in on a device whose buckets still say A.
    const submitB = jest.fn<Promise<boolean>, [AccountMergePayload]>(
      async () => true,
    )
    const outcome = await promoteAnonymousStateToAccount({
      userId: "user-b",
      submitProgress: submitB,
      submitWatchEvent: async () => true,
    })

    expect(outcome).toEqual({ status: "reset_for_other_user" })
    expect(submitB).not.toHaveBeenCalled()
    expect(await readAllAnonymousKeys()).toEqual([null, null, null, null, null])
    expect(await readLocalUserMarker()).toEqual({ userId: "user-b" })
  })

  it("does NOT claim the buckets for B when the reset's wipe fails", async () => {
    // Same shape as the case above, but the wipe is refused. Advancing the
    // marker to B here would tell the NEXT sign-in that A's surviving shelf
    // belongs to B — and since the shelf is now UPLOADED, not merely
    // displayed, that is A's history landing in B's account.
    await seedAnonymousState({
      viewerId: "viewer-anon",
      entries: [entry("a-only")],
      events: [queued("a-only")],
    })
    await promoteAnonymousStateToAccount({
      userId: "user-a",
      submitProgress: async () => true,
    })

    const storage = getStorage()
    const removeItem = jest
      .spyOn(storage, "removeItem")
      .mockImplementationOnce(async () => {
        throw new Error("storage full")
      })
    const submitB = jest.fn<Promise<boolean>, [AccountMergePayload]>(
      async () => true,
    )
    const outcome = await promoteAnonymousStateToAccount({
      userId: "user-b",
      submitProgress: submitB,
    })
    removeItem.mockRestore()

    expect(outcome).toEqual({ status: "failed" })
    expect(submitB).not.toHaveBeenCalled()
    expect(await readLocalUserMarker()).toEqual({ userId: "user-a" })
    // Still armed: B's next attempt resets rather than promoting.
    expect(decideMergeAction(await readLocalUserMarker(), "user-b")).toBe(
      "reset",
    )
  })

  it("leaves nothing of user A's behind for B to inherit after A signs out", async () => {
    // Deliberately no re-seed afterwards: overwriting the shelf key would hide
    // a leak, since B's own write replaces whatever A left there. B's payload
    // must come up EMPTY, which only holds if sign-out actually wiped.
    await seedAnonymousState({
      viewerId: "viewer-anon",
      entries: [entry("a-only")],
      events: [queued("a-only")],
    })
    await promoteAnonymousStateToAccount({
      userId: "user-a",
      submitProgress: async () => true,
    })

    await releaseLocalUserOnSignOut()

    const submitB = jest.fn<Promise<boolean>, [AccountMergePayload]>(
      async () => true,
    )
    const seenByB: string[] = []
    const outcome = await promoteAnonymousStateToAccount({
      userId: "user-b",
      submitProgress: submitB,
      submitWatchEvent: async (event) => {
        seenByB.push(event.videoId)
        return true
      },
    })

    expect(outcome).toEqual({ status: "nothing_to_promote" })
    expect(submitB).not.toHaveBeenCalled()
    expect(seenByB).toEqual([])
  })

  it("promotes what the next viewer watched after A signed out, as theirs", async () => {
    await seedAnonymousState({
      viewerId: "viewer-anon",
      entries: [entry("a-only")],
    })
    await promoteAnonymousStateToAccount({
      userId: "user-a",
      submitProgress: async () => true,
    })
    await releaseLocalUserOnSignOut()

    // Whatever the next viewer watches before signing in is genuinely theirs.
    await seedAnonymousState({
      viewerId: "viewer-fresh",
      entries: [entry("b-only")],
    })
    const submitB = jest.fn<Promise<boolean>, [AccountMergePayload]>(
      async () => true,
    )
    const outcome = await promoteAnonymousStateToAccount({
      userId: "user-b",
      submitProgress: submitB,
    })

    expect(outcome.status).toBe("promoted")
    const payload = submitB.mock.calls[0]![0]
    expect(payload.claimedUserId).toBe("user-b")
    expect(payload.viewerId).toBe("viewer-fresh")
    expect(payload.continueWatching.map((e) => e.videoId)).toEqual(["b-only"])
  })

  it("carries A's queued events to A and never to B", async () => {
    await seedAnonymousState({
      viewerId: "viewer-anon",
      events: [queued("a-only")],
    })
    const eventsSeenByA: string[] = []
    await promoteAnonymousStateToAccount({
      userId: "user-a",
      submitProgress: async () => true,
      submitWatchEvent: async (event) => {
        eventsSeenByA.push(event.videoId)
        return true
      },
    })
    expect(eventsSeenByA).toEqual(["a-only"])

    // A's queue is spent. Re-seed as if A queued more after the merge and then
    // walked away without signing out.
    await seedAnonymousState({ events: [queued("a-later")] })
    const eventsSeenByB: string[] = []
    await promoteAnonymousStateToAccount({
      userId: "user-b",
      submitProgress: async () => true,
      submitWatchEvent: async (event) => {
        eventsSeenByB.push(event.videoId)
        return true
      },
    })
    expect(eventsSeenByB).toEqual([])
    expect(await readWatchEventQueue()).toEqual([])
  })

  it("re-promotes for A only if A's own marker was released", async () => {
    await seedAnonymousState({ viewerId: "viewer-anon" })
    await writeLocalUserMarker("user-a")

    const skipped = await promoteAnonymousStateToAccount({
      userId: "user-a",
      submitProgress: async () => true,
    })
    expect(skipped).toEqual({ status: "already_merged" })

    await writeLocalUserMarker(null)
    const promoted = await promoteAnonymousStateToAccount({
      userId: "user-a",
      submitProgress: async () => true,
    })
    expect(promoted.status).toBe("promoted")
  })
})

describe("clearAnonymousWatchState", () => {
  // Both modules' prose says the wipe must go through their own lock, because
  // a bare removeItem can land between an in-flight save's read and its write —
  // and that pending write then re-materializes what was just erased, handing
  // the departing viewer's data to the next person on a shared TV. Nothing
  // tested it: routing the wipe through a plain removeItem still clears the
  // key, so key-enumeration assertions stay green either way. These do the
  // interleave for real, one per locked bucket.
  it.each([
    [
      "my list",
      MY_LIST_STORAGE_KEY,
      async () =>
        void (await toggleMyList({
          videoId: "v1",
          slug: "v1-slug",
          title: "V1",
          imageUrl: null,
          rawLabel: "FEATURE_FILM",
          addedAt: "2026-08-10T00:00:00.000Z",
        })),
    ],
    [
      "the continue watching shelf",
      CONTINUE_WATCHING_STORAGE_KEY,
      async () =>
        await saveResumeSnapshot(
          {
            videoId: "v1",
            slug: "v1-slug",
            title: "V1",
            imageUrl: null,
            updatedAt: "2026-08-10T00:00:00.000Z",
          },
          { positionSeconds: 120, durationSeconds: 1000 },
        ),
    ],
  ])(
    "a wipe racing an in-flight %s save leaves nothing behind",
    async (_label, key, save) => {
      const storage = getStorage()
      const realSetItem = storage.setItem.bind(storage)
      let releaseWrite: () => void = () => {}
      const writeHeld = new Promise<void>((resolve) => {
        releaseWrite = resolve
      })
      // Hold the save's write open, so the save is provably still mid
      // read-modify-write while the wipe runs.
      jest
        .spyOn(storage, "setItem")
        .mockImplementationOnce(async (k: string, v: string) => {
          await writeHeld
          return realSetItem(k, v)
        })

      const saving = save()
      const wiping = clearAnonymousWatchState()
      // Yield a full macrotask BEFORE letting the write land. The wipe walks
      // its keys sequentially, so this is what guarantees it has already
      // reached this bucket — an unlocked removeItem has therefore definitely
      // fired, and the released write lands AFTER it and resurrects the data.
      // With the lock the wipe is instead queued behind the save and removes
      // last, which is the whole point. (Deliberately not awaiting `wiping`
      // first: under the correct implementation that deadlocks, since the wipe
      // cannot finish until the write it is queued behind completes.)
      await new Promise((resolve) => setTimeout(resolve, 0))
      releaseWrite()
      await Promise.all([saving, wiping])

      expect(await storage.getItem(key)).toBeNull()
    },
  )

  it("clears every anonymous key from the fixed list", async () => {
    await seedAnonymousState({
      viewerId: "viewer-anon",
      entries: [entry("v1")],
      events: [queued("v1")],
      completions: [
        {
          videoId: "v1",
          slug: "v1-slug",
          positionSeconds: 1000,
          durationSeconds: 1000,
          updatedAt: "2026-08-10T00:00:00.000Z",
        },
      ],
      myList: [
        {
          videoId: "v1",
          slug: "v1-slug",
          title: "V1",
          imageUrl: null,
          rawLabel: "FEATURE_FILM",
          addedAt: "2026-08-10T00:00:00.000Z",
        },
      ],
    })
    expect(await readAllAnonymousKeys()).not.toContain(null)

    await clearAnonymousWatchState()

    expect(await readAllAnonymousKeys()).toEqual([null, null, null, null, null])
  })

  it("covers the viewer id, the shelf, pending completions and the event queue — nothing else", () => {
    // Pinned as a list, not a scan: a storage-key scan is exactly the bug this
    // module exists to avoid. A new anonymous bucket must be added here
    // deliberately, and this assertion is where that decision surfaces.
    // pending_completions joined for todo 025 — it is UPLOADED into the
    // signed-in account, so it must be part of every wipe.
    expect([...ANONYMOUS_STATE_KEYS]).toEqual([
      "forge.watch.viewer_id",
      "forge.watch.continue_watching",
      "forge.watch.pending_completions",
      "forge.watch.pending_events",
      "forge.watch.my_list",
    ])
  })

  it("keeps going when one key's removal fails", async () => {
    await seedAnonymousState({
      viewerId: "viewer-anon",
      entries: [entry("v1")],
      events: [queued("v1")],
    })
    const storage = getStorage()
    const removeItem = jest
      .spyOn(storage, "removeItem")
      .mockImplementationOnce(async () => {
        throw new Error("storage full")
      })

    await expect(clearAnonymousWatchState()).resolves.toBe(false)

    expect(removeItem).toHaveBeenCalledTimes(ANONYMOUS_STATE_KEYS.length)
    removeItem.mockRestore()
  })

  it("reports true only when every key is confirmed gone", async () => {
    await seedAnonymousState({
      viewerId: "viewer-anon",
      entries: [entry("v1")],
      events: [queued("v1")],
    })
    await expect(clearAnonymousWatchState()).resolves.toBe(true)
  })
})

describe("releaseLocalUserOnSignOut", () => {
  it("clears the buckets and the marker together", async () => {
    await seedAnonymousState({
      viewerId: "viewer-anon",
      entries: [entry("v1")],
      events: [queued("v1")],
      myList: [
        {
          videoId: "v1",
          slug: "v1-slug",
          title: "V1",
          imageUrl: null,
          rawLabel: "FEATURE_FILM",
          addedAt: "2026-08-10T00:00:00.000Z",
        },
      ],
    })
    await writeLocalUserMarker("user-a")

    await releaseLocalUserOnSignOut()

    expect(await readAllAnonymousKeys()).toEqual([null, null, null, null, null])
    expect(await readLocalUserMarker()).toEqual(UNOWNED_LOCAL_USER)
    expect(await getStorage().getItem(LOCAL_USER_STORAGE_KEY)).toBeNull()
  })

  it("KEEPS the marker when a bucket survives the wipe", async () => {
    // Fail-closed. A released marker plus a surviving shelf reads as
    // `promote` to the next viewer, so their sign-in would upload the
    // departing viewer's history into THEIR account — the marker staying put
    // makes that sign-in take `reset` and wipe again instead.
    await seedAnonymousState({
      viewerId: "viewer-anon",
      entries: [entry("v1")],
      events: [queued("v1")],
    })
    await writeLocalUserMarker("user-a")
    const storage = getStorage()
    const removeItem = jest
      .spyOn(storage, "removeItem")
      .mockImplementationOnce(async () => {
        throw new Error("storage full")
      })

    await releaseLocalUserOnSignOut()
    removeItem.mockRestore()

    expect(await readLocalUserMarker()).toEqual({ userId: "user-a" })
    // …and that marker is what makes the next viewer's sign-in a reset.
    expect(decideMergeAction(await readLocalUserMarker(), "user-b")).toBe(
      "reset",
    )
  })
})

describe("marker storage failures", () => {
  it("reads as unowned when storage throws", async () => {
    const storage = getStorage()
    jest.spyOn(storage, "getItem").mockRejectedValueOnce(new Error("nope"))
    await expect(readLocalUserMarker()).resolves.toEqual(UNOWNED_LOCAL_USER)
  })

  it("never throws when the marker cannot be written", async () => {
    const storage = getStorage()
    jest.spyOn(storage, "setItem").mockRejectedValueOnce(new Error("nope"))
    await expect(writeLocalUserMarker("user-a")).resolves.toBeUndefined()
  })
})

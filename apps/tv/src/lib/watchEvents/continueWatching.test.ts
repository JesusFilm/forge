import { _resetStorageForTests, getStorage } from "../safeStorage"
import {
  CONTINUE_WATCHING_STORAGE_KEY,
  MAX_CONTINUE_WATCHING,
  MAX_PENDING_COMPLETIONS,
  PENDING_COMPLETIONS_STORAGE_KEY,
  RESUME_FINISHED_PROGRESS,
  RESUME_MIN_SECONDS,
  applyResumeSnapshot,
  clearContinueWatching,
  getResumePosition,
  isFinished,
  isResumeWorthy,
  loadContinueWatching,
  parseContinueWatching,
  parsePendingCompletions,
  readPendingCompletions,
  removePendingCompletions,
  saveResumeSnapshot,
  updateContinueWatching,
  type ContinueWatchingEntry,
} from "./continueWatching"

beforeAll(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {})
})

beforeEach(() => {
  _resetStorageForTests()
})

const CARD = {
  videoId: "video-1",
  slug: "stunned",
  title: "Stunned",
  imageUrl: "https://img.example/stunned.jpg",
  updatedAt: "2026-08-04T00:00:00.000Z",
}

function entry(
  overrides: Partial<ContinueWatchingEntry> = {},
): ContinueWatchingEntry {
  return {
    ...CARD,
    positionSeconds: 45,
    durationSeconds: 300,
    progress: 0.15,
    ...overrides,
  }
}

describe("isResumeWorthy / isFinished", () => {
  it("rejects below the noise floor", () => {
    expect(isResumeWorthy({ positionSeconds: 5, durationSeconds: 3600 })).toBe(
      false,
    )
  })

  it("accepts past the seconds floor, and via progress on short videos", () => {
    expect(
      isResumeWorthy({
        positionSeconds: RESUME_MIN_SECONDS,
        durationSeconds: 3600,
      }),
    ).toBe(true)
    expect(isResumeWorthy({ positionSeconds: 16, durationSeconds: 60 })).toBe(
      true,
    )
  })

  it("treats >=95% as finished, not resume-worthy", () => {
    const snapshot = {
      positionSeconds: 60 * RESUME_FINISHED_PROGRESS,
      durationSeconds: 60,
    }
    expect(isFinished(snapshot)).toBe(true)
    expect(isResumeWorthy(snapshot)).toBe(false)
  })
})

describe("applyResumeSnapshot", () => {
  it("upserts most-recent-first and caps the shelf", () => {
    let entries: ContinueWatchingEntry[] = []
    for (let i = 0; i < MAX_CONTINUE_WATCHING + 2; i++) {
      entries = applyResumeSnapshot(
        entries,
        { ...CARD, videoId: `video-${i}`, slug: `slug-${i}` },
        { positionSeconds: 60, durationSeconds: 600 },
      )
    }
    expect(entries).toHaveLength(MAX_CONTINUE_WATCHING)
    expect(entries[0]!.videoId).toBe(`video-${MAX_CONTINUE_WATCHING + 1}`)
  })

  it("replaces an existing entry and moves it to the front", () => {
    let entries = [entry({ videoId: "a" }), entry({ videoId: "b" })]
    entries = applyResumeSnapshot(
      entries,
      { ...CARD, videoId: "b" },
      { positionSeconds: 120, durationSeconds: 300 },
    )
    expect(entries.map((e) => e.videoId)).toEqual(["b", "a"])
    expect(entries[0]!.positionSeconds).toBe(120)
  })

  it("keeps an existing entry when a later snapshot is below the floor", () => {
    const existing = [entry({ videoId: "a", positionSeconds: 2400 })]
    const next = applyResumeSnapshot(
      existing,
      { ...CARD, videoId: "a" },
      { positionSeconds: 4, durationSeconds: 3600 },
    )
    expect(next[0]!.positionSeconds).toBe(2400)
  })

  it("removes the entry when the video finishes", () => {
    const existing = [entry({ videoId: "a" }), entry({ videoId: "b" })]
    const next = applyResumeSnapshot(
      existing,
      { ...CARD, videoId: "a" },
      { positionSeconds: 299, durationSeconds: 300 },
    )
    expect(next.map((e) => e.videoId)).toEqual(["b"])
  })

  it("floors stored position and duration", () => {
    const next = applyResumeSnapshot([], CARD, {
      positionSeconds: 45.9,
      durationSeconds: 299.7,
    })
    expect(next[0]!.positionSeconds).toBe(45)
    expect(next[0]!.durationSeconds).toBe(299)
    expect(next[0]!.progress).toBeCloseTo(45.9 / 299.7)
  })
})

describe("parseContinueWatching", () => {
  it("drops malformed payloads and entries", () => {
    expect(parseContinueWatching(null)).toEqual([])
    expect(parseContinueWatching("{bad")).toEqual([])
    const raw = JSON.stringify([entry(), { videoId: 1 }, "junk"])
    expect(parseContinueWatching(raw)).toHaveLength(1)
  })
})

describe("storage round-trip", () => {
  it("saves, loads, and exposes resume position", async () => {
    await saveResumeSnapshot(CARD, {
      positionSeconds: 62.4,
      durationSeconds: 600,
    })
    const entries = await loadContinueWatching()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.slug).toBe("stunned")
    expect(await getResumePosition("video-1")).toBe(62)
    expect(await getResumePosition("nope")).toBeNull()
  })

  it("clears storage when the last entry finishes", async () => {
    await saveResumeSnapshot(CARD, {
      positionSeconds: 60,
      durationSeconds: 600,
    })
    await saveResumeSnapshot(CARD, {
      positionSeconds: 598,
      durationSeconds: 600,
    })
    expect(await loadContinueWatching()).toEqual([])
    expect(await getStorage().getItem(CONTINUE_WATCHING_STORAGE_KEY)).toBeNull()
  })
})

describe("locked reads", () => {
  it("load enqueued behind an un-awaited save sees the saved entry", async () => {
    const save = saveResumeSnapshot(CARD, {
      positionSeconds: 62,
      durationSeconds: 600,
    })
    const entries = await loadContinueWatching()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.positionSeconds).toBe(62)
    await save
  })
})

describe("pending completions (todo 025)", () => {
  it("records a terminal completion when a video finishes", async () => {
    await saveResumeSnapshot(CARD, {
      positionSeconds: 598,
      durationSeconds: 600,
    })
    const completions = await readPendingCompletions()
    expect(completions).toEqual([
      {
        videoId: "video-1",
        slug: "stunned",
        // Terminal by construction — position == duration, so the server
        // derives completed=true.
        positionSeconds: 600,
        durationSeconds: 600,
        updatedAt: CARD.updatedAt,
      },
    ])
    // …and the shelf entry is gone, as before.
    expect(await loadContinueWatching()).toEqual([])
  })

  it("a rewatch supersedes an unsent completion for the same video", async () => {
    // Without this, the stale completion re-sends on EVERY sync and the
    // server's staleness guard rejects it forever.
    await saveResumeSnapshot(CARD, {
      positionSeconds: 598,
      durationSeconds: 600,
    })
    await saveResumeSnapshot(CARD, {
      positionSeconds: 120,
      durationSeconds: 600,
    })
    expect(await readPendingCompletions()).toEqual([])
    expect(await loadContinueWatching()).toHaveLength(1)
  })

  it("a sub-floor snapshot does NOT supersede a completion", async () => {
    // Backing out at 5s on a rewatch is noise (below the resume floor); the
    // completion is still the truest known state.
    await saveResumeSnapshot(CARD, {
      positionSeconds: 598,
      durationSeconds: 600,
    })
    await saveResumeSnapshot(CARD, { positionSeconds: 5, durationSeconds: 600 })
    expect(await readPendingCompletions()).toHaveLength(1)
  })

  it("re-finishing replaces rather than duplicates, and the bucket is capped", async () => {
    for (let i = 0; i < MAX_PENDING_COMPLETIONS + 3; i++) {
      await saveResumeSnapshot(
        { ...CARD, videoId: `video-${i}`, slug: `slug-${i}` },
        { positionSeconds: 599, durationSeconds: 600 },
      )
    }
    await saveResumeSnapshot(
      { ...CARD, videoId: `video-${MAX_PENDING_COMPLETIONS + 2}` },
      { positionSeconds: 600, durationSeconds: 600 },
    )
    const completions = await readPendingCompletions()
    expect(completions).toHaveLength(MAX_PENDING_COMPLETIONS)
    expect(
      completions.filter(
        (c) => c.videoId === `video-${MAX_PENDING_COMPLETIONS + 2}`,
      ),
    ).toHaveLength(1)
  })

  it("removePendingCompletions drops only the named videos", async () => {
    await saveResumeSnapshot(
      { ...CARD, videoId: "a" },
      { positionSeconds: 600, durationSeconds: 600 },
    )
    await saveResumeSnapshot(
      { ...CARD, videoId: "b" },
      { positionSeconds: 600, durationSeconds: 600 },
    )
    await removePendingCompletions(["a"])
    expect((await readPendingCompletions()).map((c) => c.videoId)).toEqual([
      "b",
    ])
    // Clearing the last one removes the storage key entirely.
    await removePendingCompletions(["b"])
    expect(
      await getStorage().getItem(PENDING_COMPLETIONS_STORAGE_KEY),
    ).toBeNull()
  })

  it("parsePendingCompletions drops malformed payloads and entries", () => {
    expect(parsePendingCompletions(null)).toEqual([])
    expect(parsePendingCompletions("{bad")).toEqual([])
    const raw = JSON.stringify([
      {
        videoId: "v",
        slug: "s",
        positionSeconds: 600,
        durationSeconds: 600,
        updatedAt: "t",
      },
      { videoId: 1 },
      "junk",
    ])
    expect(parsePendingCompletions(raw)).toHaveLength(1)
  })

  it("clearContinueWatching wipes the completions bucket too", async () => {
    // The bucket is UPLOADED into whichever account signs in next, so the
    // sign-out wipe must cover it — same cross-account hazard as the shelf.
    await saveResumeSnapshot(CARD, {
      positionSeconds: 600,
      durationSeconds: 600,
    })
    expect(await readPendingCompletions()).toHaveLength(1)
    expect(await clearContinueWatching()).toBe(true)
    expect(await readPendingCompletions()).toEqual([])
  })
})

describe("updateContinueWatching", () => {
  it("applies the mutation to the stored shelf", async () => {
    await saveResumeSnapshot(CARD, {
      positionSeconds: 60,
      durationSeconds: 600,
    })
    await updateContinueWatching((entries) =>
      entries.map((e) => ({ ...e, positionSeconds: 300 })),
    )
    expect((await loadContinueWatching())[0]!.positionSeconds).toBe(300)
  })

  it("clears storage when the mutation empties the shelf", async () => {
    await saveResumeSnapshot(CARD, {
      positionSeconds: 60,
      durationSeconds: 600,
    })
    await updateContinueWatching(() => [])
    expect(await loadContinueWatching()).toEqual([])
    expect(await getStorage().getItem(CONTINUE_WATCHING_STORAGE_KEY)).toBeNull()
  })

  it("re-caps a mutation that returns more than the maximum", async () => {
    await saveResumeSnapshot(CARD, {
      positionSeconds: 60,
      durationSeconds: 600,
    })
    await updateContinueWatching(() =>
      Array.from({ length: MAX_CONTINUE_WATCHING + 5 }, (_, i) =>
        entry({ videoId: `video-${i}` }),
      ),
    )
    expect(await loadContinueWatching()).toHaveLength(MAX_CONTINUE_WATCHING)
  })

  it("runs INSIDE the shelf lock — an un-awaited save is not lost", async () => {
    // The interleave this lock exists to prevent: without it the update's
    // read would predate the save and its write would erase it.
    const save = saveResumeSnapshot(CARD, {
      positionSeconds: 62,
      durationSeconds: 600,
    })
    await updateContinueWatching((entries) =>
      entries.map((e) => ({ ...e, title: "Folded" })),
    )
    await save
    const entries = await loadContinueWatching()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.positionSeconds).toBe(62)
    expect(entries[0]!.title).toBe("Folded")
  })

  it("swallows a mutation that throws, leaving the shelf intact", async () => {
    await saveResumeSnapshot(CARD, {
      positionSeconds: 60,
      durationSeconds: 600,
    })
    await expect(
      updateContinueWatching(() => {
        throw new Error("boom")
      }),
    ).resolves.toBeUndefined()
    expect(await loadContinueWatching()).toHaveLength(1)
  })
})

describe("clearContinueWatching", () => {
  it("erases the shelf and reports success", async () => {
    await saveResumeSnapshot(CARD, {
      positionSeconds: 60,
      durationSeconds: 600,
    })
    expect(await clearContinueWatching()).toBe(true)
    expect(await loadContinueWatching()).toEqual([])
  })

  it("reports FALSE when storage refuses, so callers can fail closed", async () => {
    // The signal `releaseLocalUserOnSignOut` needs: a shelf that survived the
    // wipe must not have its ownership marker released.
    await saveResumeSnapshot(CARD, {
      positionSeconds: 60,
      durationSeconds: 600,
    })
    const storage = getStorage()
    const spy = jest
      .spyOn(storage, "removeItem")
      .mockRejectedValueOnce(new Error("storage full"))
    expect(await clearContinueWatching()).toBe(false)
    spy.mockRestore()
    expect(await loadContinueWatching()).toHaveLength(1)
  })
})

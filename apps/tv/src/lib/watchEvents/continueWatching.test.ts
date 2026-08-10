import { _resetStorageForTests, getStorage } from "../safeStorage"
import {
  CONTINUE_WATCHING_STORAGE_KEY,
  MAX_CONTINUE_WATCHING,
  RESUME_FINISHED_PROGRESS,
  RESUME_MIN_SECONDS,
  applyResumeSnapshot,
  getResumePosition,
  isFinished,
  isResumeWorthy,
  loadContinueWatching,
  parseContinueWatching,
  saveResumeSnapshot,
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

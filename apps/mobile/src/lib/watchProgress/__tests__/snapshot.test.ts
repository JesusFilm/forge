import {
  WATCH_PROGRESS_SNAPSHOT_MAX_AGE_MS,
  WATCH_PROGRESS_SNAPSHOT_MAX_BYTES,
  parseStoredProgressSnapshot,
  serializeProgressSnapshot,
} from "../snapshot"
import type { WatchProgressEntry } from "../store"

const NOW = new Date("2026-08-04T00:00:00.000Z")

function entry(
  videoId: string,
  overrides: Partial<WatchProgressEntry> = {},
): WatchProgressEntry {
  return {
    videoId,
    languageSlug: "english",
    positionSeconds: 30,
    durationSeconds: 100,
    completed: false,
    updatedAt: "2026-08-03T00:00:00.000Z",
    ...overrides,
  }
}

describe("progress snapshot persistence", () => {
  it("round-trips an account-tagged snapshot", () => {
    const blob = serializeProgressSnapshot("user-1", [entry("video-1")], NOW)
    const parsed = parseStoredProgressSnapshot(blob, NOW)

    expect(parsed?.accountId).toBe("user-1")
    expect(parsed?.entries).toEqual([entry("video-1")])
  })

  it("drops wrong-version snapshots cleanly", () => {
    const blob = JSON.stringify({
      version: 999,
      accountId: "user-1",
      entries: [entry("video-1")],
      persistedAt: NOW.getTime(),
    })
    expect(parseStoredProgressSnapshot(blob, NOW)).toBeNull()
  })

  it("degrades corrupt JSON and wrong shapes to null", () => {
    expect(parseStoredProgressSnapshot("{not json", NOW)).toBeNull()
    expect(parseStoredProgressSnapshot("null", NOW)).toBeNull()
    expect(parseStoredProgressSnapshot('"a string"', NOW)).toBeNull()
    expect(parseStoredProgressSnapshot(null, NOW)).toBeNull()
  })

  it("drops expired snapshots", () => {
    const blob = serializeProgressSnapshot("user-1", [entry("video-1")], NOW)
    const later = new Date(
      NOW.getTime() + WATCH_PROGRESS_SNAPSHOT_MAX_AGE_MS + 1,
    )
    expect(parseStoredProgressSnapshot(blob, later)).toBeNull()
  })

  it("filters malformed entries but keeps valid ones", () => {
    const blob = JSON.stringify({
      version: 1,
      accountId: "user-1",
      entries: [entry("video-1"), { videoId: 42 }, "junk", null],
      persistedAt: NOW.getTime(),
    })
    const parsed = parseStoredProgressSnapshot(blob, NOW)
    expect(parsed?.entries).toEqual([entry("video-1")])
  })

  it("requires an account tag", () => {
    const blob = JSON.stringify({
      version: 1,
      accountId: "",
      entries: [entry("video-1")],
      persistedAt: NOW.getTime(),
    })
    expect(parseStoredProgressSnapshot(blob, NOW)).toBeNull()
  })

  it("refuses to serialize past the byte ceiling", () => {
    const oversized = Array.from({ length: 3000 }, (_, index) =>
      entry(`video-${index}`, {
        languageSlug: "x".repeat(64),
      }),
    )
    const blob = serializeProgressSnapshot("user-1", oversized, NOW)
    expect(blob).toBeNull()
    // Sanity: the ceiling is what refused it.
    expect(JSON.stringify(oversized).length).toBeGreaterThan(
      WATCH_PROGRESS_SNAPSHOT_MAX_BYTES,
    )
  })
})

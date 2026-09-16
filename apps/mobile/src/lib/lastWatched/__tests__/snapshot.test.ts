/**
 * Pure parse and serialize for the last-watched record (KTD5). Nothing is
 * mocked — the whole module is a string in and a record out.
 */

import {
  LAST_WATCHED_MAX_AGE_MS,
  LAST_WATCHED_MAX_SLUG_LENGTH,
  LAST_WATCHED_STORAGE_KEY,
  LAST_WATCHED_VERSION,
  parseStoredLastWatched,
  serializeLastWatched,
} from "../snapshot"

const NOW = new Date("2026-09-16T10:00:00.000Z")

function storedBlob(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: LAST_WATCHED_VERSION,
    videoSlug: "the-birth-of-jesus",
    recordedAt: NOW.getTime(),
    ...overrides,
  })
}

describe("the module's own storage key", () => {
  it("is distinct from the watch-progress keys", () => {
    expect(LAST_WATCHED_STORAGE_KEY).toBe("last-watched-video")
  })
})

describe("serializeLastWatched", () => {
  it("round-trips a record through parse with slug and recorded time", () => {
    const blob = serializeLastWatched({
      videoSlug: "the-birth-of-jesus",
      recordedAt: NOW.getTime(),
    })

    expect(blob).not.toBeNull()
    expect(parseStoredLastWatched(blob, NOW)).toEqual({
      videoSlug: "the-birth-of-jesus",
      recordedAt: NOW.getTime(),
    })
  })

  it("refuses a record the parser would reject, so storage never holds junk", () => {
    expect(
      serializeLastWatched({ videoSlug: "", recordedAt: NOW.getTime() }),
    ).toBeNull()
    expect(
      serializeLastWatched({
        videoSlug: "a".repeat(LAST_WATCHED_MAX_SLUG_LENGTH + 1),
        recordedAt: NOW.getTime(),
      }),
    ).toBeNull()
  })

  it("stores a slug exactly at the length cap", () => {
    const videoSlug = "a".repeat(LAST_WATCHED_MAX_SLUG_LENGTH)
    const blob = serializeLastWatched({ videoSlug, recordedAt: NOW.getTime() })

    expect(parseStoredLastWatched(blob, NOW)?.videoSlug).toBe(videoSlug)
  })
})

describe("parseStoredLastWatched", () => {
  it("degrades to null for an unwritten key and for bad JSON", () => {
    expect(parseStoredLastWatched(null, NOW)).toBeNull()
    expect(parseStoredLastWatched("not json", NOW)).toBeNull()
    expect(parseStoredLastWatched("null", NOW)).toBeNull()
    expect(parseStoredLastWatched("[]", NOW)).toBeNull()
  })

  it("degrades to null for a higher version", () => {
    expect(
      parseStoredLastWatched(
        storedBlob({ version: LAST_WATCHED_VERSION + 1 }),
        NOW,
      ),
    ).toBeNull()
  })

  it("degrades to null for a missing or empty slug", () => {
    expect(
      parseStoredLastWatched(storedBlob({ videoSlug: undefined }), NOW),
    ).toBeNull()
    expect(
      parseStoredLastWatched(storedBlob({ videoSlug: "" }), NOW),
    ).toBeNull()
    expect(parseStoredLastWatched(storedBlob({ videoSlug: 7 }), NOW)).toBeNull()
  })

  it("degrades to null for a slug over the length cap", () => {
    expect(
      parseStoredLastWatched(
        storedBlob({ videoSlug: "a".repeat(LAST_WATCHED_MAX_SLUG_LENGTH + 1) }),
        NOW,
      ),
    ).toBeNull()
  })

  it("degrades to null for a missing or non-numeric recorded time", () => {
    expect(
      parseStoredLastWatched(storedBlob({ recordedAt: undefined }), NOW),
    ).toBeNull()
    expect(
      parseStoredLastWatched(storedBlob({ recordedAt: "yesterday" }), NOW),
    ).toBeNull()
    expect(
      parseStoredLastWatched(storedBlob({ recordedAt: Number.NaN }), NOW),
    ).toBeNull()
  })

  it("counts a record older than 30 days as absent (R19)", () => {
    const stale = NOW.getTime() - LAST_WATCHED_MAX_AGE_MS - 1

    expect(
      parseStoredLastWatched(storedBlob({ recordedAt: stale }), NOW),
    ).toBeNull()
  })

  it("keeps a record exactly at the 30-day boundary", () => {
    const edge = NOW.getTime() - LAST_WATCHED_MAX_AGE_MS

    expect(
      parseStoredLastWatched(storedBlob({ recordedAt: edge }), NOW),
    ).toEqual({ videoSlug: "the-birth-of-jesus", recordedAt: edge })
  })

  it("keeps a record recorded in the future (a clock that moved backwards)", () => {
    const future = NOW.getTime() + 60_000

    expect(
      parseStoredLastWatched(storedBlob({ recordedAt: future }), NOW)
        ?.videoSlug,
    ).toBe("the-birth-of-jesus")
  })
})

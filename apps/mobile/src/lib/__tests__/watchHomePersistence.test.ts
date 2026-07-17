import {
  WATCH_HOME_CAROUSEL_SESSION_MAX_AGE_MS,
  WATCH_HOME_SNAPSHOT_MAX_AGE_MS,
  WATCH_HOME_SNAPSHOT_VERSION,
  currentStorageMonth,
  parseStoredCarouselSession,
  parseStoredHomeSnapshot,
  parseStoredPlayedIds,
  serializeCarouselSession,
  serializeHomeSnapshot,
  serializeHomeSnapshotFromVideosJson,
  serializePlayedIds,
} from "../watchHomePersistence"

const NOW = new Date("2026-06-11T12:00:00Z")

describe("currentStorageMonth", () => {
  it("formats the UTC ISO month (web parity)", () => {
    expect(currentStorageMonth(NOW)).toBe("2026-06")
    expect(currentStorageMonth(new Date("2026-01-31T23:59:59Z"))).toBe(
      "2026-01",
    )
  })
})

describe("parseStoredPlayedIds", () => {
  it("returns an empty set for a null (never-written) blob", () => {
    expect(parseStoredPlayedIds(null, NOW).size).toBe(0)
  })

  it("returns an empty set for malformed JSON instead of throwing", () => {
    expect(parseStoredPlayedIds("{not json", NOW).size).toBe(0)
  })

  it("returns an empty set for valid JSON that isn't an object", () => {
    expect(parseStoredPlayedIds("42", NOW).size).toBe(0)
    expect(parseStoredPlayedIds("null", NOW).size).toBe(0)
    expect(parseStoredPlayedIds('["a"]', NOW).size).toBe(0)
  })

  it("drops a blob from a different month (monthly rotation reset)", () => {
    const stale = JSON.stringify({ month: "2026-05", ids: ["a", "b"] })
    expect(parseStoredPlayedIds(stale, NOW).size).toBe(0)
  })

  it("reads ids for the current month", () => {
    const raw = JSON.stringify({ month: "2026-06", ids: ["a", "b"] })
    expect([...parseStoredPlayedIds(raw, NOW)]).toEqual(["a", "b"])
  })

  it("filters non-string ids", () => {
    const raw = JSON.stringify({ month: "2026-06", ids: ["a", 7, null, "b"] })
    expect([...parseStoredPlayedIds(raw, NOW)]).toEqual(["a", "b"])
  })

  it("round-trips through serializePlayedIds", () => {
    const ids = new Set(["video-1", "video-2"])
    expect([
      ...parseStoredPlayedIds(serializePlayedIds(ids, NOW), NOW),
    ]).toEqual(["video-1", "video-2"])
  })

  it("a set serialized last month parses empty this month", () => {
    const may = new Date("2026-05-20T12:00:00Z")
    const raw = serializePlayedIds(new Set(["video-1"]), may)
    expect(parseStoredPlayedIds(raw, NOW).size).toBe(0)
  })
})

describe("parseStoredCarouselSession", () => {
  const session = {
    videoId: "video-1",
    poolIndex: 4,
    timestamp: NOW.getTime() - 60_000,
  }

  it("returns null for a null (never-written) blob", () => {
    expect(parseStoredCarouselSession(null, NOW)).toBeNull()
  })

  it("returns null for malformed JSON instead of throwing", () => {
    expect(parseStoredCarouselSession("{not json", NOW)).toBeNull()
  })

  it("returns null for wrong-shaped blobs", () => {
    expect(parseStoredCarouselSession("42", NOW)).toBeNull()
    expect(
      parseStoredCarouselSession(JSON.stringify({ videoId: "v" }), NOW),
    ).toBeNull()
    expect(
      parseStoredCarouselSession(
        JSON.stringify({ ...session, poolIndex: "4" }),
        NOW,
      ),
    ).toBeNull()
  })

  it("returns null for a negative or fractional poolIndex", () => {
    expect(
      parseStoredCarouselSession(
        JSON.stringify({ ...session, poolIndex: -1 }),
        NOW,
      ),
    ).toBeNull()
    expect(
      parseStoredCarouselSession(
        JSON.stringify({ ...session, poolIndex: 1.5 }),
        NOW,
      ),
    ).toBeNull()
  })

  it("returns null once the session is older than 24h (web parity)", () => {
    const expired = {
      ...session,
      timestamp: NOW.getTime() - WATCH_HOME_CAROUSEL_SESSION_MAX_AGE_MS - 1,
    }
    expect(parseStoredCarouselSession(JSON.stringify(expired), NOW)).toBeNull()
  })

  it("reads a fresh session", () => {
    expect(parseStoredCarouselSession(JSON.stringify(session), NOW)).toEqual(
      session,
    )
  })

  it("accepts poolIndex 0 (the first-pool resume point)", () => {
    const firstPool = { ...session, poolIndex: 0 }
    expect(parseStoredCarouselSession(JSON.stringify(firstPool), NOW)).toEqual(
      firstPool,
    )
  })

  it("round-trips through serializeCarouselSession", () => {
    expect(
      parseStoredCarouselSession(serializeCarouselSession(session), NOW),
    ).toEqual(session)
  })
})

describe("parseStoredHomeSnapshot", () => {
  const videos = [
    { coreId: "1_jf-0-0", slug: "jesus", children: [] },
    { coreId: "2_GOJ-0-0", slug: "goj" },
  ]
  const valid = JSON.stringify({
    version: WATCH_HOME_SNAPSHOT_VERSION,
    persistedAt: NOW.getTime() - 60_000,
    videos,
  })

  it("returns null for a null (never-written) blob", () => {
    expect(parseStoredHomeSnapshot(null, NOW)).toBeNull()
  })

  it("returns null for malformed JSON instead of throwing", () => {
    expect(parseStoredHomeSnapshot("{not json", NOW)).toBeNull()
  })

  it("returns null for a version mismatch (fragment shape drift)", () => {
    const drifted = JSON.stringify({
      version: WATCH_HOME_SNAPSHOT_VERSION + 1,
      persistedAt: NOW.getTime(),
      videos,
    })
    expect(parseStoredHomeSnapshot(drifted, NOW)).toBeNull()
  })

  it("returns null once the snapshot is older than 7 days", () => {
    const expired = JSON.stringify({
      version: WATCH_HOME_SNAPSHOT_VERSION,
      persistedAt: NOW.getTime() - WATCH_HOME_SNAPSHOT_MAX_AGE_MS - 1,
      videos,
    })
    expect(parseStoredHomeSnapshot(expired, NOW)).toBeNull()
  })

  it("returns null for non-array or empty videos (never paints the empty state)", () => {
    for (const bad of [{}, [], "x", null, [null, "x"]]) {
      const blob = JSON.stringify({
        version: WATCH_HOME_SNAPSHOT_VERSION,
        persistedAt: NOW.getTime(),
        videos: bad,
      })
      expect(parseStoredHomeSnapshot(blob, NOW)).toBeNull()
    }
  })

  it("filters non-object items but keeps the rest", () => {
    const mixed = JSON.stringify({
      version: WATCH_HOME_SNAPSHOT_VERSION,
      persistedAt: NOW.getTime(),
      videos: [videos[0], "junk", null, videos[1]],
    })
    expect(parseStoredHomeSnapshot(mixed, NOW)?.videos).toEqual(videos)
  })

  it("reads a fresh snapshot", () => {
    const parsed = parseStoredHomeSnapshot(valid, NOW)
    expect(parsed?.videos).toEqual(videos)
    expect(parsed?.persistedAt).toBe(NOW.getTime() - 60_000)
  })

  it("round-trips through serializeHomeSnapshot", () => {
    const parsed = parseStoredHomeSnapshot(
      serializeHomeSnapshot(videos, NOW),
      NOW,
    )
    expect(parsed?.videos).toEqual(videos)
    expect(parsed?.persistedAt).toBe(NOW.getTime())
  })

  it("serializeHomeSnapshotFromVideosJson produces the identical blob (hot-path concat contract)", () => {
    const fromJson = serializeHomeSnapshotFromVideosJson(
      JSON.stringify(videos),
      NOW,
    )
    expect(fromJson).toBe(serializeHomeSnapshot(videos, NOW))
    expect(parseStoredHomeSnapshot(fromJson, NOW)?.videos).toEqual(videos)
  })

  it("carries the Experience body blocks when tagged (v2 source-tag)", () => {
    const blocks = [{ __typename: "MediaCollectionBlock", sectionKey: "s" }]
    const blob = JSON.stringify({
      version: WATCH_HOME_SNAPSHOT_VERSION,
      persistedAt: NOW.getTime(),
      videos,
      blocks,
    })
    expect(parseStoredHomeSnapshot(blob, NOW)?.blocks).toEqual(blocks)
  })

  it("returns null blocks for a config-body snapshot (blocks absent)", () => {
    expect(parseStoredHomeSnapshot(valid, NOW)?.blocks).toBeNull()
  })

  it("discards an old v1 snapshot on migration day (version bump)", () => {
    const v1 = JSON.stringify({
      version: 1,
      persistedAt: NOW.getTime(),
      videos,
    })
    expect(parseStoredHomeSnapshot(v1, NOW)).toBeNull()
  })

  it("round-trips Experience blocks through the JSON serializer", () => {
    const blocks = [{ __typename: "MediaCollectionBlock", sectionKey: "s" }]
    const parsed = parseStoredHomeSnapshot(
      serializeHomeSnapshotFromVideosJson(
        JSON.stringify(videos),
        NOW,
        JSON.stringify(blocks),
      ),
      NOW,
    )
    expect(parsed?.videos).toEqual(videos)
    expect(parsed?.blocks).toEqual(blocks)
  })
})

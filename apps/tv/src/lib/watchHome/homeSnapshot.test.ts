import {
  WATCH_HOME_SNAPSHOT_MAX_AGE_MS,
  WATCH_HOME_SNAPSHOT_VERSION,
  parseStoredHomeSnapshot,
  serializeHomeSnapshot,
} from "./homeSnapshot"
import type { WatchHomeVideoInput } from "./model"

const NOW = new Date("2026-06-30T00:00:00Z")
// parseStoredHomeSnapshot only shallow-checks items (non-null object), so minimal
// stand-ins are enough to exercise the schema guardrails.
const videos = [
  { coreId: "a" },
  { coreId: "b" },
] as unknown as WatchHomeVideoInput[]

describe("home snapshot round-trip", () => {
  it("serialize → parse returns the videos and persistedAt", () => {
    const parsed = parseStoredHomeSnapshot(
      serializeHomeSnapshot(videos, NOW),
      NOW,
    )
    expect(parsed?.videos).toEqual(videos)
    expect(parsed?.persistedAt).toBe(NOW.getTime())
  })
})

describe("parseStoredHomeSnapshot guardrails", () => {
  it("returns null for null / malformed / non-object raw", () => {
    expect(parseStoredHomeSnapshot(null, NOW)).toBeNull()
    expect(parseStoredHomeSnapshot("{not json", NOW)).toBeNull()
    expect(parseStoredHomeSnapshot("42", NOW)).toBeNull()
  })

  it("rejects a version mismatch (fragment-shape drift)", () => {
    const blob = `{"version":${WATCH_HOME_SNAPSHOT_VERSION + 1},"persistedAt":${NOW.getTime()},"videos":[{"coreId":"a"}]}`
    expect(parseStoredHomeSnapshot(blob, NOW)).toBeNull()
  })

  it("rejects a snapshot older than the TTL but keeps one at the boundary", () => {
    const blob = serializeHomeSnapshot(videos, NOW)
    const expired = new Date(NOW.getTime() + WATCH_HOME_SNAPSHOT_MAX_AGE_MS + 1)
    const boundary = new Date(NOW.getTime() + WATCH_HOME_SNAPSHOT_MAX_AGE_MS)
    expect(parseStoredHomeSnapshot(blob, expired)).toBeNull()
    expect(parseStoredHomeSnapshot(blob, boundary)).not.toBeNull()
  })

  it("never paints empty: an empty videos array returns null", () => {
    expect(
      parseStoredHomeSnapshot(serializeHomeSnapshot([], NOW), NOW),
    ).toBeNull()
  })

  it("rejects a non-array videos field", () => {
    const blob = `{"version":${WATCH_HOME_SNAPSHOT_VERSION},"persistedAt":${NOW.getTime()},"videos":"nope"}`
    expect(parseStoredHomeSnapshot(blob, NOW)).toBeNull()
  })

  it("drops non-object items but keeps the valid ones", () => {
    const blob = `{"version":${WATCH_HOME_SNAPSHOT_VERSION},"persistedAt":${NOW.getTime()},"videos":[{"coreId":"a"},null,7,{"coreId":"b"}]}`
    expect(parseStoredHomeSnapshot(blob, NOW)?.videos).toEqual([
      { coreId: "a" },
      { coreId: "b" },
    ])
  })
})

import { describe, expect, it } from "vitest"
import {
  encodeWatchHistoryFact,
  watchExactDigest,
  watchGroupDigest,
  WatchEventCodecError,
} from "./watch-event-history"

const fact = {
  eventId: "00000000-0000-4000-8000-000000000001",
  rankId: "00000000-0000-4000-8000-000000000002",
  windowId: "00000000-0000-4000-8000-000000000003",
  surface: "watch-search",
  block: "results",
  presentation: "result-list",
  placement: "search-results",
  policyVersion: "watch-exposure-v1",
  position: 0,
  itemPath: "/watch/example.html",
  kind: "selected",
  visibilityCapability: null,
  occurredAt: new Date("2026-10-28T00:00:00.000Z"),
  receivedAt: new Date("2026-10-28T00:00:01.000Z"),
  expiresAt: new Date("2026-11-11T00:00:01.000Z"),
  duplicateCount: 2,
  revision: 3,
}

describe("Watch history codec", () => {
  it("keeps immutable receipt identity, original receive time, and revision count", () => {
    const correction = encodeWatchHistoryFact(
      fact,
      new Date("2026-10-29T00:00:00.000Z"),
    )
    expect(correction).toMatchObject({
      family: "watch-exposure",
      logicalId: fact.eventId,
      revision: 3,
      acceptedAt: "2026-10-29T00:00:00.000Z",
      expiresAt: fact.expiresAt.toISOString(),
      payload: {
        eventId: fact.eventId,
        rankId: fact.rankId,
        receivedAt: "2026-10-28T00:00:01.000Z",
        duplicateCount: 2,
      },
    })
    expect(correction.payload).not.toHaveProperty("revision")
  })

  it("groups same card and kind but distinguishes replay payloads", () => {
    expect(watchGroupDigest(fact)).toBe(
      watchGroupDigest({
        ...fact,
        occurredAt: new Date("2026-10-28T00:01:00.000Z"),
      }),
    )
    expect(watchExactDigest(fact)).not.toBe(
      watchExactDigest({
        ...fact,
        occurredAt: new Date("2026-10-28T00:01:00.000Z"),
      }),
    )
    expect(watchGroupDigest(fact)).not.toBe(
      watchGroupDigest({ ...fact, kind: "eligible" }),
    )
  })

  it("rejects an expired correction with a typed error", () => {
    expect(() => encodeWatchHistoryFact(fact, fact.expiresAt)).toThrow(
      WatchEventCodecError,
    )
  })
})

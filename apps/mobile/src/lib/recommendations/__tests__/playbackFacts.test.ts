import {
  PLAYBACK_BODY_BYTES,
  PLAYBACK_EVENT_LIMIT,
  boundedDuration,
  boundedPosition,
  boundedWallMs,
  buildPlaybackFactsVariables,
  parsePlaybackEpisode,
  playbackPosition,
  takeBatch,
  utf8ByteLength,
  type PlaybackFact,
} from "../playbackFacts"

const IDENTITY = { viewerToken: "v".repeat(43), sessionToken: "s".repeat(43) }
const EPISODE = {
  episodeId: "ep-1",
  capability: "cap-1",
  activeUntil: "2026-09-16T01:00:00.000Z",
  hardUntil: "2026-09-16T02:00:00.000Z",
}

function progress(index: number, padding = ""): PlaybackFact {
  return {
    eventId: `playback_progress:${index}${padding}`,
    kind: "playback_progress",
    occurredAt: "2026-09-16T00:00:00.000Z",
    payload: {
      positionSeconds: index,
      durationSeconds: 100,
      progress: index / 100,
      wallElapsedMilliseconds: index * 1000,
    },
  }
}

describe("bounds", () => {
  it("clamps positions and durations to Admin's ranges", () => {
    expect(boundedPosition(-5)).toBe(0)
    expect(boundedPosition(Number.NaN)).toBe(0)
    expect(boundedPosition("3")).toBe(0)
    expect(boundedPosition(90_000)).toBe(86_400)
    expect(boundedDuration(0)).toBeNull()
    expect(boundedDuration(Number.POSITIVE_INFINITY)).toBeNull()
    expect(boundedDuration(90_000)).toBe(86_400)
    expect(boundedWallMs(-1)).toBe(0)
    expect(boundedWallMs(7 * 60 * 60 * 1000)).toBe(6 * 60 * 60 * 1000)
  })

  it("derives progress only when a duration exists", () => {
    expect(playbackPosition(30, 120)).toEqual({
      positionSeconds: 30,
      durationSeconds: 120,
      progress: 0.25,
    })
    expect(playbackPosition(30, 0)).toEqual({
      positionSeconds: 30,
      durationSeconds: null,
      progress: null,
    })
    expect(playbackPosition(200, 100).progress).toBe(1)
  })
})

describe("parsePlaybackEpisode", () => {
  it("accepts Admin's claim shape and rejects a malformed one", () => {
    expect(parsePlaybackEpisode(EPISODE)).toEqual(EPISODE)
    expect(parsePlaybackEpisode(null)).toBeNull()
    expect(parsePlaybackEpisode({ ...EPISODE, episodeId: "" })).toBeNull()
    expect(parsePlaybackEpisode({ ...EPISODE, capability: 1 })).toBeNull()
    expect(parsePlaybackEpisode({ ...EPISODE, activeUntil: "soon" })).toBeNull()
    expect(
      parsePlaybackEpisode({
        ...EPISODE,
        hardUntil: "2026-09-16T00:30:00.000Z",
      }),
    ).toBeNull()
  })
})

describe("buildPlaybackFactsVariables", () => {
  it("binds the batch to the episode under the evidence contract", () => {
    const variables = buildPlaybackFactsVariables(
      IDENTITY,
      EPISODE,
      "media-1",
      [progress(1)],
    )
    expect(variables).toEqual({
      contractVersion: "recommendation-evidence-v1",
      capability: "cap-1",
      episodeId: "ep-1",
      viewerToken: IDENTITY.viewerToken,
      sessionToken: IDENTITY.sessionToken,
      mediaId: "media-1",
      events: [progress(1)],
    })
    expect(variables).not.toHaveProperty("sessionDigest")
  })
})

describe("utf8ByteLength", () => {
  it("counts bytes, not code units", () => {
    expect(utf8ByteLength("abc")).toBe(3)
    expect(utf8ByteLength("é")).toBe(2)
    expect(utf8ByteLength("あ")).toBe(3)
    expect(utf8ByteLength("😀")).toBe(4)
    expect(utf8ByteLength("a😀b")).toBe(6)
  })
})

describe("takeBatch", () => {
  const serialize = (events: PlaybackFact[]) =>
    JSON.stringify(
      buildPlaybackFactsVariables(IDENTITY, EPISODE, "media-1", events),
    )

  it("takes at most 16 facts", () => {
    const queue = Array.from({ length: 20 }, (_, i) => progress(i))
    const batch = takeBatch(queue, serialize)
    expect(batch.events).toHaveLength(PLAYBACK_EVENT_LIMIT)
    expect(batch.oversized).toBeNull()
  })

  it("stops before the serialized body crosses 8 KB", () => {
    // Each fact carries a ~1 KB event id, so fewer than 16 fit.
    const queue = Array.from({ length: 16 }, (_, i) =>
      progress(i, "x".repeat(1_000)),
    )
    const batch = takeBatch(queue, serialize)
    expect(batch.events.length).toBeGreaterThan(0)
    expect(batch.events.length).toBeLessThan(16)
    expect(utf8ByteLength(serialize(batch.events))).toBeLessThanOrEqual(
      PLAYBACK_BODY_BYTES,
    )
    expect(
      utf8ByteLength(serialize([...batch.events, queue[batch.events.length]!])),
    ).toBeGreaterThan(PLAYBACK_BODY_BYTES)
  })

  it("reports a fact that cannot fit even alone as oversized", () => {
    const huge = progress(0, "x".repeat(9_000))
    const batch = takeBatch([huge, progress(1)], serialize)
    expect(batch.events).toEqual([])
    expect(batch.oversized).toBe(huge)
  })
})

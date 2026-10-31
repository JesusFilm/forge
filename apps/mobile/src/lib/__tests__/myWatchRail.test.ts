import { libraryRowAffordance } from "../libraryDownloads"
import {
  MY_WATCH_RAIL_MAX_TILES,
  buildMyWatchRail,
  type MyWatchRailSeriesTile,
  type MyWatchRailTile,
  type MyWatchRailVideoTile,
} from "../myWatchRail"
import {
  OFFLINE_MANIFEST_VERSION,
  type OfflineDownloadRecord,
  type OfflineDownloadState,
} from "../offlineManifest"

function record(
  videoSlug: string,
  state: OfflineDownloadState,
  overrides: Partial<OfflineDownloadRecord> = {},
): OfflineDownloadRecord {
  return {
    version: OFFLINE_MANIFEST_VERSION,
    videoSlug,
    dubDocumentId: "dub",
    renditionDocumentId: "rend",
    qualityLabel: "High",
    title: "Test",
    subtitleLanguageSlug: null,
    state,
    committedPath: null,
    pendingPath: null,
    posterPath: null,
    bytesWritten: 0,
    totalBytes: 0,
    ...overrides,
  }
}

const MB = 1024 * 1024

function keys(tiles: readonly MyWatchRailTile[]): string[] {
  return tiles.map((tile) => tile.key)
}

function asVideo(tile: MyWatchRailTile | undefined): MyWatchRailVideoTile {
  if (tile?.kind !== "video") throw new Error(`expected a video tile`)
  return tile
}

function asSeries(tile: MyWatchRailTile | undefined): MyWatchRailSeriesTile {
  if (tile?.kind !== "series") throw new Error(`expected a series tile`)
  return tile
}

describe("buildMyWatchRail — order (KTD4)", () => {
  it("returns videos newest first, and an in-progress tile carries its progress (AE2)", () => {
    const oldest = record("v-1", "downloaded", {
      enqueuedAt: 100,
      totalBytes: 10 * MB,
    })
    const middle = record("v-2", "downloaded", {
      enqueuedAt: 200,
      totalBytes: 10 * MB,
    })
    const inFlight = record("v-3", "downloading", {
      enqueuedAt: 300,
      bytesWritten: 3 * MB,
      totalBytes: 10 * MB,
    })
    const newest = record("v-4", "downloaded", {
      enqueuedAt: 400,
      totalBytes: 10 * MB,
    })

    const tiles = buildMyWatchRail([middle, inFlight, oldest, newest])

    expect(keys(tiles)).toEqual([
      "video:v-4",
      "video:v-3",
      "video:v-2",
      "video:v-1",
    ])
    const ring = asVideo(tiles[1])
    expect(ring.record).toBe(inFlight)
    expect(ring.rowState.affordance).toBe("ring")
    expect(ring.rowState.progress).toBeCloseTo(0.3)
  })

  it("puts a series first as ONE tile when its newest episode beats every video", () => {
    const video = record("solo", "downloaded", { enqueuedAt: 500 })
    const olderEpisode = record("ep-1", "downloaded", {
      seriesSlug: "acts",
      seriesTitle: "Acts",
      seriesEpisodeIndex: 1,
      enqueuedAt: 100,
    })
    const newerEpisode = record("ep-2", "downloaded", {
      seriesSlug: "acts",
      seriesTitle: "Acts",
      seriesEpisodeIndex: 2,
      enqueuedAt: 900,
    })

    const tiles = buildMyWatchRail([video, olderEpisode, newerEpisode])

    expect(keys(tiles)).toEqual(["series:acts", "video:solo"])
    const series = asSeries(tiles[0])
    expect(series.group.seriesSlug).toBe("acts")
    expect(series.episodeCount).toBe(2)
  })

  it("sorts undated records after every dated record, and undated ones by slug", () => {
    const dated = record("m-dated", "downloaded", { enqueuedAt: 1 })
    const undatedB = record("b-undated", "downloaded")
    const undatedA = record("a-undated", "downloaded")

    const tiles = buildMyWatchRail([undatedB, dated, undatedA])

    expect(keys(tiles)).toEqual([
      "video:m-dated",
      "video:a-undated",
      "video:b-undated",
    ])
  })

  it("sorts an undated series among undated videos by its series slug", () => {
    const video = record("b-video", "downloaded")
    const epA = record("ep-a", "downloaded", { seriesSlug: "a-series" })
    const epB = record("ep-b", "downloaded", { seriesSlug: "a-series" })
    const lateVideo = record("c-video", "downloaded")

    const tiles = buildMyWatchRail([lateVideo, video, epA, epB])

    expect(keys(tiles)).toEqual([
      "series:a-series",
      "video:b-video",
      "video:c-video",
    ])
  })

  it("orders a series and a video with EQUAL enqueuedAt the same way for any input order", () => {
    const video = record("b-video", "downloaded", { enqueuedAt: 700 })
    const epA = record("ep-a", "downloaded", {
      seriesSlug: "a-series",
      enqueuedAt: 700,
    })
    const epB = record("ep-b", "downloaded", {
      seriesSlug: "a-series",
      enqueuedAt: 300,
    })

    const forward = keys(buildMyWatchRail([video, epA, epB]))
    const reversed = keys(buildMyWatchRail([epB, epA, video]))

    expect(forward).toEqual(["series:a-series", "video:b-video"])
    expect(reversed).toEqual(forward)
  })

  it("orders two videos with EQUAL enqueuedAt by slug for any input order", () => {
    const b = record("b", "downloaded", { enqueuedAt: 50 })
    const a = record("a", "downloaded", { enqueuedAt: 50 })

    expect(keys(buildMyWatchRail([b, a]))).toEqual(["video:a", "video:b"])
    expect(keys(buildMyWatchRail([a, b]))).toEqual(["video:a", "video:b"])
  })
})

describe("buildMyWatchRail — one-episode series (R21)", () => {
  it("returns a video tile for the only episode, not a series tile (AE7)", () => {
    const onlyEpisode = record("ep-only", "downloaded", {
      seriesSlug: "acts",
      seriesTitle: "Acts",
      enqueuedAt: 10,
      totalBytes: 5 * MB,
    })

    const tiles = buildMyWatchRail([onlyEpisode])

    expect(tiles).toHaveLength(1)
    const tile = asVideo(tiles[0])
    expect(tile.key).toBe("video:ep-only")
    expect(tile.record).toBe(onlyEpisode)
    expect(tile.rowState).toEqual(libraryRowAffordance(onlyEpisode))
  })

  it("orders a converted episode tile by that episode's own enqueuedAt", () => {
    const newerVideo = record("solo", "downloaded", { enqueuedAt: 20 })
    const onlyEpisode = record("ep-only", "downloaded", {
      seriesSlug: "acts",
      enqueuedAt: 10,
    })

    expect(keys(buildMyWatchRail([onlyEpisode, newerVideo]))).toEqual([
      "video:solo",
      "video:ep-only",
    ])
  })
})

describe("buildMyWatchRail — cap", () => {
  it("returns exactly 10 tiles from 12 downloads and drops the two oldest", () => {
    const records = Array.from({ length: 12 }, (_, i) =>
      record(`v-${String(i + 1).padStart(2, "0")}`, "downloaded", {
        enqueuedAt: (i + 1) * 100,
      }),
    )

    const tiles = buildMyWatchRail(records)

    expect(MY_WATCH_RAIL_MAX_TILES).toBe(10)
    expect(tiles).toHaveLength(10)
    expect(keys(tiles)).not.toContain("video:v-01")
    expect(keys(tiles)).not.toContain("video:v-02")
    expect(tiles[0]?.key).toBe("video:v-12")
    expect(tiles[9]?.key).toBe("video:v-03")
  })

  it("counts a series as one tile against the cap", () => {
    const episodes = Array.from({ length: 5 }, (_, i) =>
      record(`ep-${i}`, "downloaded", {
        seriesSlug: "acts",
        enqueuedAt: 5_000 + i,
      }),
    )
    const videos = Array.from({ length: 10 }, (_, i) =>
      record(`v-${i}`, "downloaded", { enqueuedAt: 100 + i }),
    )

    const tiles = buildMyWatchRail([...videos, ...episodes])

    expect(tiles).toHaveLength(10)
    expect(tiles[0]?.key).toBe("series:acts")
    expect(keys(tiles)).not.toContain("video:v-0")
    expect(keys(tiles)).toContain("video:v-1")
  })
})

describe("buildMyWatchRail — series aggregate state", () => {
  function seriesOf(...episodes: OfflineDownloadRecord[]) {
    return asSeries(buildMyWatchRail(episodes)[0])
  }

  it("reports failed when one episode failed and one finished", () => {
    const tile = seriesOf(
      record("ep-1", "failed", { seriesSlug: "s" }),
      record("ep-2", "downloaded", { seriesSlug: "s", totalBytes: MB }),
    )
    expect(tile.state.status).toBe("failed")
    expect(tile.group.failedEpisodeCount).toBe(1)
  })

  it("reports in progress when one episode downloads and one finished", () => {
    const tile = seriesOf(
      record("ep-1", "downloading", {
        seriesSlug: "s",
        bytesWritten: 50,
        totalBytes: 100,
      }),
      record("ep-2", "downloaded", { seriesSlug: "s", totalBytes: 100 }),
    )
    expect(tile.state.status).toBe("inProgress")
    expect(tile.state.progress).toBeCloseTo(0.75)
  })

  it("puts failed ahead of in progress", () => {
    const tile = seriesOf(
      record("ep-1", "failed", { seriesSlug: "s" }),
      record("ep-2", "downloading", {
        seriesSlug: "s",
        bytesWritten: 1,
        totalBytes: 2,
      }),
    )
    expect(tile.state.status).toBe("failed")
  })

  it("counts queued and paused episodes as in progress", () => {
    expect(
      seriesOf(
        record("ep-1", "queued", { seriesSlug: "s" }),
        record("ep-2", "downloaded", { seriesSlug: "s" }),
      ).state.status,
    ).toBe("inProgress")
    expect(
      seriesOf(
        record("ep-1", "paused", {
          seriesSlug: "s",
          bytesWritten: 25,
          totalBytes: 100,
        }),
        record("ep-2", "queued", { seriesSlug: "s" }),
      ).state,
    ).toEqual({ status: "inProgress", progress: 0.125 })
  })

  it("reports downloaded with full progress when every episode finished", () => {
    const tile = seriesOf(
      record("ep-1", "downloaded", { seriesSlug: "s" }),
      record("ep-2", "downloaded", { seriesSlug: "s" }),
    )
    expect(tile.state).toEqual({ status: "downloaded", progress: 1 })
  })

  it("reads a mid-swap episode as downloaded, as its list row does (R7)", () => {
    const midSwap = record("ep-1", "downloading", {
      seriesSlug: "s",
      bytesWritten: 10,
      totalBytes: 100,
      swapFrom: {
        committedPath: "file:///old.mp4",
        renditionDocumentId: "old-rend",
        dubDocumentId: "old-dub",
        qualityLabel: "Low",
        subtitleLanguageSlug: null,
        totalBytes: 80,
        posterPath: null,
      },
    })
    expect(libraryRowAffordance(midSwap).affordance).toBe("check")

    const tile = seriesOf(
      midSwap,
      record("ep-2", "downloaded", { seriesSlug: "s" }),
    )
    expect(tile.state).toEqual({ status: "downloaded", progress: 1 })
  })
})

describe("buildMyWatchRail — video tile state (R7)", () => {
  it("maps paused and queued records to the paused and queued row states", () => {
    const paused = record("p", "paused", { enqueuedAt: 2 })
    const queued = record("q", "queued", { enqueuedAt: 1 })

    const [pausedTile, queuedTile] = buildMyWatchRail([paused, queued])

    expect(asVideo(pausedTile).rowState).toEqual({
      affordance: "resume",
    })
    expect(asVideo(queuedTile).rowState).toEqual({
      affordance: "none",
    })
  })

  it("maps failed and downloaded records to their row states", () => {
    const failed = record("f", "failed", { enqueuedAt: 2 })
    const done = record("d", "downloaded", {
      enqueuedAt: 1,
      totalBytes: 12 * MB,
    })

    const [failedTile, doneTile] = buildMyWatchRail([failed, done])

    expect(asVideo(failedTile).rowState.affordance).toBe("retry")
    expect(asVideo(doneTile).rowState).toEqual({
      affordance: "check",
    })
  })
})

describe("buildMyWatchRail — empty", () => {
  it("returns no tiles for no records", () => {
    expect(buildMyWatchRail([])).toHaveLength(0)
  })
})

/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from "vitest"
import {
  WATCH_HOME_TV_CURRENT_VIDEO_STORAGE_KEY,
  WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY,
  addWatchHomeTvPlayedId,
  addWatchHomeVerticalVideoId,
  boundedRandomIndex,
  buildWatchHomeVideoQueue,
  getWatchHomeDeterministicOffset,
  isWatchHomeHeroPlayableAspect,
  pickRandomWatchHomeHeroVideo,
  readWatchHomeVerticalVideoIds,
  loadWatchHomeCurrentVideoSession,
  poolFailuresStorageKey,
  poolVideosStorageKey,
  readWatchHomeTvPlayedIds,
  saveWatchHomeCurrentVideoSession,
  type WatchHomeCarouselPool,
  type WatchHomeTvCarouselVideoSlide,
} from "./watch-home-carousel-sequence"

const currentMonth = new Date().toISOString().slice(0, 7)

function video(id: string): WatchHomeTvCarouselVideoSlide {
  return {
    kind: "video",
    id,
    title: id,
    description: null,
    label: "Short film",
    href: `/${id}.html/english.html`,
    posterUrl: `${id}.jpg`,
    thumbnailUrl: `${id}-thumb.jpg`,
    imageAlt: id,
    src: `${id}.m3u8`,
    playbackId: `mux-${id}`,
    durationSeconds: 10,
  }
}

function pool(id: string, videos: string[]): WatchHomeCarouselPool {
  return {
    id,
    collectionIds: [id],
    videos: videos.map(video),
  }
}

describe("watch home carousel sequence helpers", () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it("uses deterministic daily offsets for pool selection", () => {
    const now = new Date("2026-06-04T12:00:00.000Z")

    expect(
      getWatchHomeDeterministicOffset("pool-a", 12, {
        now,
        poolIndex: 0,
        totalVideosLoaded: 0,
      }),
    ).toBe(
      getWatchHomeDeterministicOffset("pool-a", 12, {
        now,
        poolIndex: 0,
        totalVideosLoaded: 0,
      }),
    )
    expect(getWatchHomeDeterministicOffset("pool-a", 0, { now })).toBe(0)
  })

  it("draws the hero uniformly from every pooled video the server shipped", () => {
    const pools = [
      pool("pool-a", ["video-a", "video-b"]),
      pool("pool-b", ["video-c"]),
    ]
    const drawn = [0, 0.5, 0.99].map(
      (value) =>
        pickRandomWatchHomeHeroVideo({ pools, random: () => value })?.id,
    )

    expect(drawn).toEqual(["video-a", "video-b", "video-c"])
    expect(
      pickRandomWatchHomeHeroVideo({ pools, random: () => 0.5 })?.poolId,
    ).toBe("pool-a")
  })

  it("keeps portrait and near-square sources out of the wide hero frame", () => {
    // 16:9 and 4:3 fill the frame; 1:1, 4:5 and 9:16 would render as a cropped
    // centre strip under object-cover.
    expect(isWatchHomeHeroPlayableAspect(1920, 1080)).toBe(true)
    expect(isWatchHomeHeroPlayableAspect(1440, 1080)).toBe(true)
    expect(isWatchHomeHeroPlayableAspect(1080, 1080)).toBe(false)
    expect(isWatchHomeHeroPlayableAspect(1080, 1350)).toBe(false)
    expect(isWatchHomeHeroPlayableAspect(1080, 1920)).toBe(false)
  })

  it("allows anything it cannot measure rather than dropping it", () => {
    expect(isWatchHomeHeroPlayableAspect(0, 0)).toBe(true)
    expect(isWatchHomeHeroPlayableAspect(null, null)).toBe(true)
    expect(isWatchHomeHeroPlayableAspect(undefined, undefined)).toBe(true)
    expect(isWatchHomeHeroPlayableAspect(Number.NaN, 1080)).toBe(true)
    expect(isWatchHomeHeroPlayableAspect(1920, 0)).toBe(true)
  })

  it("never draws an excluded video, even once everything else is played", () => {
    const pools = [pool("pool-a", ["video-a", "video-b"])]

    expect(
      pickRandomWatchHomeHeroVideo({
        pools,
        excludedIds: ["video-a"],
        random: () => 0,
      })?.id,
    ).toBe("video-b")
    // playedIds fall back to the full set when everything has been seen;
    // excludedIds must not.
    expect(
      pickRandomWatchHomeHeroVideo({
        pools,
        excludedIds: ["video-a"],
        playedIds: ["video-a", "video-b"],
        random: () => 0,
      })?.id,
    ).toBe("video-b")
    expect(
      pickRandomWatchHomeHeroVideo({
        pools,
        excludedIds: ["video-a", "video-b"],
        random: () => 0,
      }),
    ).toBeNull()
  })

  it("keeps excluded videos out of every queue-build path", () => {
    const pools = [pool("pool-a", ["video-a", "video-b", "video-c"])]
    const excludedIds = ["video-b"]

    const built = buildWatchHomeVideoQueue({
      pools,
      excludedIds,
      targetVideoCount: 3,
      useStoredProgress: false,
    })
    expect(built.videos.map((entry) => entry.id)).not.toContain("video-b")

    // The early-exit path returns existing videos untouched otherwise.
    const earlyExit = buildWatchHomeVideoQueue({
      pools,
      excludedIds,
      existingVideos: [video("video-b"), video("video-c")],
      targetVideoCount: 1,
      useStoredProgress: false,
    })
    expect(earlyExit.videos.map((entry) => entry.id)).toEqual(["video-c"])
  })

  it("remembers measured-portrait videos for the current month only", () => {
    const now = new Date("2026-08-27T12:00:00.000Z")
    addWatchHomeVerticalVideoId("video-a", now)
    addWatchHomeVerticalVideoId("video-a", now)
    addWatchHomeVerticalVideoId("video-b", now)

    expect(readWatchHomeVerticalVideoIds(now)).toEqual(["video-a", "video-b"])
    expect(
      readWatchHomeVerticalVideoIds(new Date("2026-09-01T00:00:00.000Z")),
    ).toEqual([])
    expect(readWatchHomeVerticalVideoIds(now)).toEqual([])
  })

  it("skips already played videos until the whole library has been seen", () => {
    const pools = [pool("pool-a", ["video-a", "video-b"])]

    expect(
      pickRandomWatchHomeHeroVideo({
        pools,
        playedIds: ["video-a"],
        random: () => 0,
      })?.id,
    ).toBe("video-b")
    expect(
      pickRandomWatchHomeHeroVideo({
        pools,
        playedIds: ["video-a", "video-b"],
        random: () => 0,
      })?.id,
    ).toBe("video-a")
    expect(
      pickRandomWatchHomeHeroVideo({ pools: [], random: () => 0 }),
    ).toBeNull()
  })

  it("never draws a video without a playable source", () => {
    const unplayable = { ...video("video-b"), src: null }
    const pools = [
      {
        id: "pool-a",
        collectionIds: ["pool-a"],
        videos: [video("video-a"), unplayable],
      },
    ]

    expect(
      pickRandomWatchHomeHeroVideo({ pools, random: () => 0.99 })?.id,
    ).toBe("video-a")
  })

  it("keeps a random draw inside the candidate list", () => {
    expect(boundedRandomIndex(3, () => 0.999999)).toBe(2)
    expect(boundedRandomIndex(3, () => 1)).toBe(2)
    expect(boundedRandomIndex(3, () => -1)).toBe(0)
    expect(boundedRandomIndex(3, () => Number.NaN)).toBe(0)
    expect(boundedRandomIndex(0, () => 0.5)).toBe(0)
  })

  it("swaps the daily pool offset for a per-visit draw when a random source is supplied", () => {
    const pools = [pool("pool-a", ["video-a", "video-b", "video-c"])]
    const now = new Date("2026-06-04T12:00:00.000Z")

    const deterministic = buildWatchHomeVideoQueue({
      pools,
      targetVideoCount: 1,
      now,
      useStoredProgress: false,
    }).videos.map((entry) => entry.id)
    const lastFirst = buildWatchHomeVideoQueue({
      pools,
      targetVideoCount: 1,
      now,
      useStoredProgress: false,
      randomSource: () => 0.99,
    }).videos.map((entry) => entry.id)
    const firstFirst = buildWatchHomeVideoQueue({
      pools,
      targetVideoCount: 1,
      now,
      useStoredProgress: false,
      randomSource: () => 0,
    }).videos.map((entry) => entry.id)

    expect(deterministic).toEqual(
      buildWatchHomeVideoQueue({
        pools,
        targetVideoCount: 1,
        now,
        useStoredProgress: false,
      }).videos.map((entry) => entry.id),
    )
    expect(lastFirst).toEqual(["video-c"])
    expect(firstFirst).toEqual(["video-a"])
  })

  it("stores and expires persistent played ids in the Core monthly shape", () => {
    addWatchHomeTvPlayedId("video-1")

    expect(readWatchHomeTvPlayedIds()).toEqual(["video-1"])
    expect(
      JSON.parse(
        window.localStorage.getItem(WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY) ??
          "{}",
      ),
    ).toEqual({
      month: currentMonth,
      ids: ["video-1"],
    })

    window.localStorage.setItem(
      WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY,
      JSON.stringify({ month: "2000-01", ids: ["old"] }),
    )

    expect(readWatchHomeTvPlayedIds()).toEqual([])
    expect(
      window.localStorage.getItem(WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY),
    ).toBeNull()
  })

  it("builds a progressive queue from playlist pools while avoiding played videos", () => {
    const now = new Date("2026-06-04T12:00:00.000Z")
    addWatchHomeTvPlayedId("video-a", now)
    window.sessionStorage.setItem(
      poolVideosStorageKey("pool-b"),
      JSON.stringify(["video-c"]),
    )

    const result = buildWatchHomeVideoQueue({
      pools: [
        pool("pool-a", ["video-a", "video-b"]),
        pool("pool-b", ["video-c", "video-d"]),
      ],
      targetVideoCount: 2,
      now,
    })

    expect(result.videos.map((item) => item.id)).toEqual(["video-b", "video-d"])
    expect(result.videos.map((item) => item.poolId)).toEqual([
      "pool-a",
      "pool-b",
    ])
    expect(result.nextPoolIndex).toBe(2)
  })

  it("tracks repeated pool failures and marks depleted pools exhausted", () => {
    const now = new Date("2026-06-04T12:00:00.000Z")
    addWatchHomeTvPlayedId("video-a", now)

    for (let attempt = 0; attempt < 3; attempt++) {
      buildWatchHomeVideoQueue({
        pools: [pool("pool-a", ["video-a"])],
        targetVideoCount: 1,
        now,
      })
    }

    expect(
      window.sessionStorage.getItem(poolFailuresStorageKey("pool-a")),
    ).toBe("3")
    expect(
      JSON.parse(
        window.sessionStorage.getItem(poolVideosStorageKey("pool-a")) ?? "[]",
      ),
    ).toEqual(["exhausted-0"])
  })

  it("resets monthly played memory after fifty loaded videos so cycling can continue", () => {
    const now = new Date("2026-06-04T12:00:00.000Z")
    addWatchHomeTvPlayedId("video-a", now)

    const result = buildWatchHomeVideoQueue({
      existingVideos: Array.from({ length: 50 }, (_, index) =>
        video(`existing-${index}`),
      ),
      pools: [pool("pool-a", ["video-a"])],
      targetVideoCount: 51,
      now,
    })

    expect(readWatchHomeTvPlayedIds()).toEqual([])
    expect(result.videos.at(-1)?.id).toBe("video-a")
  })

  it("persists current video session for 24 hours", () => {
    const selected = {
      ...video("video-session"),
      poolId: "pool-a",
      poolIndex: 2,
    }
    saveWatchHomeCurrentVideoSession(selected)

    expect(loadWatchHomeCurrentVideoSession()).toMatchObject({
      videoId: "video-session",
      videoTitle: "video-session",
      poolId: "pool-a",
      poolIndex: 2,
    })

    window.sessionStorage.setItem(
      WATCH_HOME_TV_CURRENT_VIDEO_STORAGE_KEY,
      JSON.stringify({
        videoId: "old",
        videoTitle: "Old",
        poolId: "pool-a",
        poolIndex: 0,
        timestamp: 0,
      }),
    )

    expect(loadWatchHomeCurrentVideoSession(new Date("2026-06-04"))).toBeNull()
  })
})

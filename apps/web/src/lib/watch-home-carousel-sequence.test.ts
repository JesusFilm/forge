/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from "vitest"
import type { WatchHomeMuxInsertConfig } from "@/lib/watch-home-config"
import {
  WATCH_HOME_TV_CURRENT_VIDEO_STORAGE_KEY,
  WATCH_HOME_TV_MUX_SELECTIONS_STORAGE_KEY,
  WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY,
  addWatchHomeTvPlayedId,
  buildWatchHomeVideoQueue,
  getWatchHomeDeterministicOffset,
  loadWatchHomeCurrentVideoSession,
  mergeWatchHomeMuxInserts,
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

const muxInsert = {
  id: "welcome-start",
  copyId: "welcomeStart",
  enabled: true,
  playbackIds: ["playback-a"],
  durationSeconds: 9,
  action: null,
  logo: true,
  posterOverride: null,
  trigger: { type: "sequence-start" },
} satisfies WatchHomeMuxInsertConfig

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

  it("merges Mux inserts with date prefix and session-stable playback ids", () => {
    const slides = mergeWatchHomeMuxInserts(
      [video("video-1"), video("video-2")],
      [
        muxInsert,
        {
          ...muxInsert,
          id: "join-us",
          copyId: "joinUs",
          playbackIds: ["join-a", "join-b"],
          trigger: { type: "after-count", count: 1 },
          action: {
            copyId: "joinUs",
            url: "https://example.com",
          },
        },
      ],
      new Date("2026-06-04T12:00:00.000Z"),
    )

    expect(slides.map((slide) => slide.id)).toEqual([
      "mux-welcome-start",
      "video-1",
      "mux-join-us",
      "video-2",
    ])
    expect(slides[0]).toMatchObject({
      kind: "mux",
      copyId: "welcomeStart",
      titleDate: "2026-06-04T12:00:00.000Z",
      playbackId: "playback-a",
      secondaryAction: null,
    })
    expect(slides[2]).toMatchObject({
      kind: "mux",
      copyId: "joinUs",
      secondaryAction: {
        type: "watch-short-film",
      },
    })
    const stored = JSON.parse(
      window.sessionStorage.getItem(WATCH_HOME_TV_MUX_SELECTIONS_STORAGE_KEY) ??
        "{}",
    )
    expect(["join-a", "join-b"]).toContain(stored["join-us"])
  })

  it("preserves the stable copy id of a selected conditional overlay", () => {
    const [slide] = mergeWatchHomeMuxInserts(
      [],
      [
        {
          ...muxInsert,
          conditionalOverlays: [
            {
              copyId: "welcomeMorning",
              priority: 10,
              conditions: [{ type: "time-range", range: { start: 5, end: 9 } }],
              overlay: {},
            },
          ],
        },
      ],
      new Date("2026-06-04T12:00:00.000Z"),
      { useStoredSelections: false },
    )

    expect(slide).toMatchObject({
      kind: "mux",
      copyId: "welcomeMorning",
      titleDate: "2026-06-04T12:00:00.000Z",
    })
  })
})

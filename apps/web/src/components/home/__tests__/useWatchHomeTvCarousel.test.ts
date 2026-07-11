/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from "vitest"
import {
  WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY,
  WATCH_HOME_TV_VIDEO_PREVIEW_MAX_SECONDS,
  addWatchHomeTvPlayedId,
  firstUnplayedWatchHomeTvCarouselIndex,
  nextUnplayedWatchHomeTvCarouselIndex,
  readWatchHomeTvPlayedIds,
  shouldAdvanceWatchHomeTvCarousel,
  watchHomeTvAdvanceTargetSeconds,
  watchHomeTvProgressPercent,
} from "@/components/home/useWatchHomeTvCarousel"
import type { WatchHomeTvCarouselSlide } from "@/components/home/useWatchHomeTvCarousel"

const currentMonth = new Date().toISOString().slice(0, 7)

function slide(id: string, src = `${id}.m3u8`): WatchHomeTvCarouselSlide {
  return {
    kind: "video",
    id,
    shareVideoSlug: id,
    shareLanguageSlug: "english",
    title: id,
    description: null,
    label: "Featured",
    href: `/${id}.html/english.html`,
    posterUrl: `${id}.jpg`,
    thumbnailUrl: `${id}-thumb.jpg`,
    imageAlt: id,
    src,
    playbackId: id,
    durationSeconds: 10,
  }
}

describe("watch home TV carousel browser storage sequencing", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("stores played IDs in the upstream monthly localStorage shape", () => {
    addWatchHomeTvPlayedId("video-1")
    addWatchHomeTvPlayedId("video-1")
    addWatchHomeTvPlayedId("video-2")

    expect(readWatchHomeTvPlayedIds()).toEqual(["video-1", "video-2"])
    expect(
      JSON.parse(
        window.localStorage.getItem(WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY) ??
          "{}",
      ),
    ).toEqual({
      month: currentMonth,
      ids: ["video-1", "video-2"],
    })
  })

  it("expires the played ID list when a new month begins", () => {
    window.localStorage.setItem(
      WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY,
      JSON.stringify({ month: "2000-01", ids: ["video-1"] }),
    )

    expect(readWatchHomeTvPlayedIds()).toEqual([])
    expect(
      window.localStorage.getItem(WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY),
    ).toBeNull()
  })

  it("starts on the first playable slide the browser has not already seen", () => {
    window.localStorage.setItem(
      WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY,
      JSON.stringify({ month: currentMonth, ids: ["video-1"] }),
    )

    expect(
      firstUnplayedWatchHomeTvCarouselIndex([
        slide("video-1"),
        slide("video-2"),
        slide("video-3"),
      ]),
    ).toBe(1)
  })

  it("advances to the next unplayed playable slide before repeating", () => {
    window.localStorage.setItem(
      WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY,
      JSON.stringify({ month: currentMonth, ids: ["video-1", "video-2"] }),
    )

    expect(
      nextUnplayedWatchHomeTvCarouselIndex(0, [
        slide("video-1"),
        slide("video-2"),
        slide("video-3"),
      ]),
    ).toBe(2)
  })

  it("resets storage only after every playable slide has been seen", () => {
    window.localStorage.setItem(
      WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY,
      JSON.stringify({ month: currentMonth, ids: ["video-1", "video-2"] }),
    )

    expect(
      nextUnplayedWatchHomeTvCarouselIndex(1, [
        slide("video-1"),
        slide("video-2"),
      ]),
    ).toBe(0)
    expect(readWatchHomeTvPlayedIds()).toEqual([])
  })
})

describe("watch home TV carousel preview timing", () => {
  it("caps long video previews at 30 seconds", () => {
    expect(watchHomeTvAdvanceTargetSeconds(120)).toBe(
      WATCH_HOME_TV_VIDEO_PREVIEW_MAX_SECONDS,
    )
    expect(watchHomeTvProgressPercent(15, 120)).toBe(50)
    expect(watchHomeTvProgressPercent(30, 120)).toBe(100)
    expect(shouldAdvanceWatchHomeTvCarousel(100, 99)).toBe(true)
  })

  it("keeps short video previews near their natural end", () => {
    expect(watchHomeTvAdvanceTargetSeconds(20)).toBe(19)
    expect(watchHomeTvProgressPercent(9.5, 20)).toBe(50)
    expect(watchHomeTvProgressPercent(19, 20)).toBe(100)
  })
})

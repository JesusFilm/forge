/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from "vitest"
import {
  WATCH_HOME_TV_ENDED_BACKSTOP_GRACE_SECONDS,
  WATCH_HOME_TV_IMAGE_SLIDE_ADVANCE_SECONDS,
  WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY,
  WATCH_HOME_TV_UNKNOWN_DURATION_SECONDS,
  addWatchHomeTvPlayedId,
  firstUnplayedWatchHomeTvCarouselIndex,
  nextUnplayedWatchHomeTvCarouselIndex,
  readWatchHomeTvPlayedIds,
  watchHomeTvAdvanceBackstopSeconds,
  watchHomeTvSlideDurationSeconds,
} from "@/components/home/useWatchHomeTvCarousel"
import type { WatchHomeTvCarouselSlide } from "@/components/home/useWatchHomeTvCarousel"

const currentMonth = new Date().toISOString().slice(0, 7)

function slide(id: string, src = `${id}.m3u8`): WatchHomeTvCarouselSlide {
  return {
    kind: "video",
    id,
    title: id,
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

describe("watch home TV carousel advance duration", () => {
  function videoSlide(
    durationSeconds: number | null,
  ): WatchHomeTvCarouselSlide {
    return { ...slide("video-1"), durationSeconds }
  }

  function imageSlide(): WatchHomeTvCarouselSlide {
    return { ...slide("image-1"), src: null, durationSeconds: null }
  }

  it("plays a long video to its natural end instead of capping it", () => {
    expect(watchHomeTvSlideDurationSeconds(videoSlide(120), null)).toBe(120)
    expect(watchHomeTvAdvanceBackstopSeconds(videoSlide(120), null)).toBe(
      120 + WATCH_HOME_TV_ENDED_BACKSTOP_GRACE_SECONDS,
    )
  })

  it("keeps a short video on the same rule", () => {
    expect(watchHomeTvSlideDurationSeconds(videoSlide(20), null)).toBe(20)
    expect(watchHomeTvAdvanceBackstopSeconds(videoSlide(20), null)).toBe(
      20 + WATCH_HOME_TV_ENDED_BACKSTOP_GRACE_SECONDS,
    )
  })

  // The deleted 30-second cap was the only thing absorbing a non-finite
  // duration. `setTimeout(fn, NaN)` and `setTimeout(fn, Infinity)` both
  // coerce to 0, which would race the whole queue in a few hundred ms, and
  // `${NaN}s` in the ring's CSS custom property silently kills the animation.
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["a negative number", -1],
    ["zero", 0],
    ["a huge number", 1e12],
  ])("returns a finite positive duration for %s", (_label, measured) => {
    const ring = watchHomeTvSlideDurationSeconds(
      videoSlide(null),
      measured as number | null | undefined,
    )
    const backstop = watchHomeTvAdvanceBackstopSeconds(
      videoSlide(null),
      measured as number | null | undefined,
    )

    for (const value of [ring, backstop]) {
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeGreaterThan(0)
    }
  })

  it("falls back well above the retired 30 second cap when nothing is known", () => {
    expect(watchHomeTvSlideDurationSeconds(videoSlide(null), null)).toBe(
      WATCH_HOME_TV_UNKNOWN_DURATION_SECONDS,
    )
    expect(WATCH_HOME_TV_UNKNOWN_DURATION_SECONDS).toBeGreaterThan(30)
  })

  it("prefers the measured duration over the slide record", () => {
    expect(watchHomeTvSlideDurationSeconds(videoSlide(10), 480)).toBe(480)
  })

  it("falls back to the slide record when the measurement is not usable", () => {
    expect(watchHomeTvSlideDurationSeconds(videoSlide(10), Number.NaN)).toBe(10)
    expect(
      watchHomeTvSlideDurationSeconds(videoSlide(10), Number.POSITIVE_INFINITY),
    ).toBe(10)
  })

  it("gives an image slide its own turn length and no backstop grace", () => {
    expect(watchHomeTvSlideDurationSeconds(imageSlide(), 480)).toBe(
      WATCH_HOME_TV_IMAGE_SLIDE_ADVANCE_SECONDS,
    )
    expect(watchHomeTvAdvanceBackstopSeconds(imageSlide(), 480)).toBe(
      WATCH_HOME_TV_IMAGE_SLIDE_ADVANCE_SECONDS,
    )
  })
})

/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from "vitest"
import {
  WATCH_HOME_PROGRAM_EXPOSURE_SECONDS,
  WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY,
  WATCH_HOME_TV_VIDEO_PREVIEW_MAX_SECONDS,
  accumulateWatchHomeProgramPlayback,
  addWatchHomeTvPlayedId,
  firstUnplayedWatchHomeTvCarouselIndex,
  getWatchHomeAccountSeenVideoIds,
  nextUnplayedWatchHomeTvCarouselIndex,
  readWatchHomeTvPlayedIds,
  shouldAdvanceWatchHomeTvCarousel,
  watchHomeProgramSelectionToCarouselSlide,
  watchHomeTvAdvanceTargetSeconds,
  watchHomeTvProgressPercent,
} from "@/components/home/useWatchHomeTvCarousel"
import type { WatchHomeTvCarouselSlide } from "@/components/home/useWatchHomeTvCarousel"
import type { WatchHomeProgramSelection } from "@/lib/watch-home-carousel-sequence"

const currentMonth = new Date().toISOString().slice(0, 7)

function slide(id: string, src = `${id}.m3u8`): WatchHomeTvCarouselSlide {
  return {
    kind: "video",
    id,
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

describe("watch home editorial program playback", () => {
  it("uses only account progress entries with a visible progress ratio", () => {
    expect(
      getWatchHomeAccountSeenVideoIds([
        {
          videoId: "not-started",
          positionSeconds: 0.2,
          durationSeconds: 100,
          updatedAt: 1,
        },
        {
          videoId: "started",
          positionSeconds: 1,
          durationSeconds: 100,
          updatedAt: 2,
        },
        {
          videoId: "complete",
          positionSeconds: 100,
          durationSeconds: 100,
          updatedAt: 3,
        },
      ]),
    ).toEqual(["started", "complete"])
  })

  it("maps authored promo copy and semantic identity without using legacy copy IDs", () => {
    const selection: WatchHomeProgramSelection = {
      kind: "promo",
      identity: "promo:summer-campaign",
      sequenceId: "program-entry-1-promo:summer-campaign",
      itemId: "summer-campaign",
      bucketId: "promos",
      isIntro: false,
      item: {
        id: "summer-campaign",
        playbackId: "promo-playback",
        src: "https://stream.mux.com/promo-playback.m3u8",
        durationSeconds: 2,
        posterUrl: "https://cdn.example/promo.jpg",
        label: "Get involved",
        title: "You can help",
        description: "Join the mission.",
        showLogo: true,
        primaryAction: {
          label: "Join now",
          href: "/watch/join",
          icon: "join",
        },
        secondaryAction: {
          label: "Learn more",
          href: "https://www.jesusfilm.org/about",
          icon: null,
        },
      },
    }

    expect(watchHomeProgramSelectionToCarouselSlide(selection)).toMatchObject({
      kind: "promo",
      id: selection.sequenceId,
      programIdentity: selection.identity,
      programIsIntro: false,
      title: "You can help",
      primaryAction: selection.item.primaryAction,
      secondaryAction: selection.item.secondaryAction,
    })
  })

  it("counts only bounded visible playing deltas toward the three-second exposure", () => {
    let sample = accumulateWatchHomeProgramPlayback({
      accumulatedSeconds: 0,
      currentTime: 1.5,
      previousTime: 0,
      isPlaying: true,
      isVisible: true,
    })
    expect(sample.accumulatedSeconds).toBe(1.5)
    expect(sample.exposed).toBe(false)

    sample = accumulateWatchHomeProgramPlayback({
      accumulatedSeconds: sample.accumulatedSeconds,
      currentTime: 2.5,
      previousTime: 1.5,
      isPlaying: true,
      isVisible: false,
    })
    expect(sample.accumulatedSeconds).toBe(1.5)

    sample = accumulateWatchHomeProgramPlayback({
      accumulatedSeconds: sample.accumulatedSeconds,
      currentTime: 4,
      previousTime: 2.5,
      isPlaying: true,
      isVisible: true,
    })
    expect(sample.accumulatedSeconds).toBe(WATCH_HOME_PROGRAM_EXPOSURE_SECONDS)
    expect(sample.exposed).toBe(true)

    expect(
      accumulateWatchHomeProgramPlayback({
        accumulatedSeconds: 0,
        currentTime: 20,
        previousTime: 0,
        isPlaying: true,
        isVisible: true,
      }),
    ).toEqual({ accumulatedSeconds: 2, exposed: false })
  })
})

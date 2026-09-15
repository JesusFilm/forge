import { describe, expect, it } from "vitest"

import { resolveMuxHeroPosterUrlAtMaxWidth } from "@/lib/url"
import { cardToCarouselSlide, type WatchHomeCard } from "@/lib/watch-home"

function makeCard(overrides: Partial<WatchHomeCard> = {}): WatchHomeCard {
  return {
    id: "doc-1",
    sourceId: "source-1",
    coreId: "core-1",
    title: "Jesus",
    // Display text, deliberately left reading like a feature film while the
    // wire label below says otherwise: the intro guard must key on the wire
    // value, so this default proves the display string alone excludes nothing.
    label: "Feature Film",
    videoLabel: "SEGMENT",
    metaLabel: null,
    href: "/jesus.html/english.html",
    imageUrl:
      "https://imagedelivery.net/acct/1_jf-0-0.mobileCinematicHigh.jpg/f=jpg,w=1280,h=600,q=95",
    blurDataUrl: null,
    dominantColor: null,
    imageAlt: "Jesus still",
    hls: "https://stream.example/jesus.m3u8",
    playbackId: "playback-1",
    durationSeconds: 120,
    childCount: 0,
    parentCoreId: null,
    parentSlug: null,
    missingData: [],
    ...overrides,
  }
}

describe("cardToCarouselSlide posters", () => {
  it("posters the full-bleed intro from the Mux frame, and the card from the authored image", () => {
    // The admin library stores mobile derivatives for these videos — the
    // `mobileCinematicHigh` above measured 640x300, which the full-bleed intro
    // upscales about fourfold. The Mux frame is 1280x720 from the derivative
    // the watch-page hero already warms. At card size the authored image has
    // pixels to spare and stays preferred.
    const slide = cardToCarouselSlide(makeCard())

    expect(slide?.posterUrl).toBe(
      resolveMuxHeroPosterUrlAtMaxWidth("playback-1"),
    )
    expect(slide?.posterUrl).not.toContain("imagedelivery.net")
    expect(slide?.thumbnailUrl).toContain("mobileCinematicHigh")
  })

  it("falls back to the authored image when the video has no Mux playback", () => {
    const slide = cardToCarouselSlide(makeCard({ playbackId: null }))

    expect(slide?.posterUrl).toContain("mobileCinematicHigh")
  })

  it("treats a blank authored image as absent, not as a poster", () => {
    // Admin passes image columns through raw, so "" is a real shape. `??`
    // would keep it and render an empty tile.
    const slide = cardToCarouselSlide(
      makeCard({ playbackId: null, imageUrl: "" }),
    )

    expect(slide?.posterUrl).toBeNull()
  })

  it("keeps a card with neither image nor playback posterless rather than blank-stringed", () => {
    const slide = cardToCarouselSlide(
      makeCard({ playbackId: null, imageUrl: null }),
    )

    expect(slide?.posterUrl).toBeNull()
  })
})

describe("cardToCarouselSlide feature-film exclusion", () => {
  it("drops a feature film so one turn cannot hold the intro for hours", () => {
    // `1_jf-0-0` is a configured hero source and measured 7674s against
    // production admin on 2026-09-14. The intro plays to the natural end, so
    // admitting it would park the hero for over two hours.
    const slide = cardToCarouselSlide(
      makeCard({
        coreId: "1_jf-0-0",
        videoLabel: "FEATURE_FILM",
        durationSeconds: 7674,
      }),
    )

    expect(slide).toBeNull()
  })

  it("keys on the wire label, not the rendered copy", () => {
    // The factory's display `label` already reads "Feature Film". If the guard
    // compared that string instead of `videoLabel`, this eligible segment
    // would be dropped and the test above would pass for the wrong reason.
    const slide = cardToCarouselSlide(
      makeCard({ label: "Feature Film", videoLabel: "SEGMENT" }),
    )

    expect(slide).not.toBeNull()
    expect(slide?.id).toBe("core-1")
  })

  it("admits every other label the hero pool actually serves", () => {
    // Measured children of the four configured hero sources on 2026-09-14:
    // SEGMENT (1_jf-0-0, 2_GOJ-0-0, GOMattCollection), plus COLLECTION,
    // SHORT_FILM and SERIES under LUMOCollection.
    for (const videoLabel of [
      "SEGMENT",
      "EPISODE",
      "SHORT_FILM",
      "COLLECTION",
      "SERIES",
    ]) {
      expect(cardToCarouselSlide(makeCard({ videoLabel }))).not.toBeNull()
    }
  })

  it("admits an unknown or absent label rather than failing closed", () => {
    // Matches `isWatchHomeHeroPlayableAspect`: the guard only ever acts on a
    // label it positively recognises, so a new admin label cannot silently
    // empty the intro.
    expect(cardToCarouselSlide(makeCard({ videoLabel: null }))).not.toBeNull()
    expect(
      cardToCarouselSlide(makeCard({ videoLabel: "BEHIND_THE_SCENES" })),
    ).not.toBeNull()
  })
})

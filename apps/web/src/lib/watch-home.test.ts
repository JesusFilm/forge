import { describe, expect, it } from "vitest"

import { resolveMuxHeroPosterUrlAtMaxWidth } from "@/lib/url"
import { cardToCarouselSlide, type WatchHomeCard } from "@/lib/watch-home"

function makeCard(overrides: Partial<WatchHomeCard> = {}): WatchHomeCard {
  return {
    id: "doc-1",
    sourceId: "source-1",
    coreId: "core-1",
    title: "Jesus",
    label: "Feature Film",
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

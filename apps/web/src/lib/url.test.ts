import { describe, expect, it } from "vitest"

import {
  MUX_HERO_POSTER_MAX_WIDTH,
  resolveDownloadPosterUrl,
  resolveMuxFrameThumbnailUrl,
  resolveMuxHeroPosterUrlAtMaxWidth,
} from "./url"

describe("resolveDownloadPosterUrl", () => {
  it("requests a high-resolution Mux frame for the full-width modal", () => {
    expect(resolveDownloadPosterUrl(null, " playback/id ")).toBe(
      "https://image.mux.com/playback%2Fid/thumbnail.jpg?width=1280&height=720&fit_mode=smartcrop&time=2",
    )
  })

  it("prefers a high-resolution Cloudflare editorial derivative over Mux", () => {
    expect(
      resolveDownloadPosterUrl(
        {
          mobileCinematicHigh:
            "https://imagedelivery.net/account/poster.jpg/f=jpg,w=120,h=68,q=95",
        },
        "playback-id",
      ),
    ).toBe(
      "https://imagedelivery.net/account/poster.jpg/f=jpg,w=1280,h=720,q=95",
    )
  })

  it("preserves non-Cloudflare editorial poster URLs over Mux", () => {
    expect(
      resolveDownloadPosterUrl(
        { mobileCinematicHigh: "https://cdn.test/editorial-high.jpg" },
        "playback-id",
      ),
    ).toBe("https://cdn.test/editorial-high.jpg")
  })

  it("does not rewrite Cloudflare named variants without dimensions", () => {
    expect(
      resolveDownloadPosterUrl(
        {
          mobileCinematicHigh:
            "https://imagedelivery.net/account/poster.jpg/public",
        },
        null,
      ),
    ).toBe("https://imagedelivery.net/account/poster.jpg/public")
  })

  it("returns null without Mux or editorial images", () => {
    expect(resolveDownloadPosterUrl(null, null)).toBeNull()
  })

  it("does not change the card-sized Mux thumbnail recipe", () => {
    expect(resolveMuxFrameThumbnailUrl("playback-id")).toBe(
      "https://image.mux.com/playback-id/thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2",
    )
  })
})

describe("resolveMuxFrameThumbnailUrl", () => {
  // Vertical (9:16) sources are the reason `fit_mode=smartcrop` is pinned:
  // Mux's default `preserve` pads the frame into the requested box, so a
  // 9:16 episode comes back 142x252 and renders as a letterboxed sliver
  // inside a 16:9 card.
  it("always requests a filled crop rather than a padded fit", () => {
    const url = new URL(resolveMuxFrameThumbnailUrl("playback-id")!)
    expect(url.searchParams.get("fit_mode")).toBe("smartcrop")
    expect(url.searchParams.get("width")).toBe("448")
    expect(url.searchParams.get("height")).toBe("252")
  })

  // Mux caches derivatives per exact URL and admin pre-generates exactly one
  // 16:9 recipe (WATCH_CHAPTER_CAROUSEL_RECIPE). A width/format drift here
  // silently moves every card onto a cold on-demand render and orphans the
  // matching muxThumbnailBlurDataUrl LQIP.
  it("stays byte-identical to admin's pre-generated carousel recipe", () => {
    expect(resolveMuxFrameThumbnailUrl("playback-id")).toBe(
      "https://image.mux.com/playback-id/thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2",
    )
  })

  it("returns null for a blank or missing playback id", () => {
    expect(resolveMuxFrameThumbnailUrl(null)).toBeNull()
    expect(resolveMuxFrameThumbnailUrl(undefined)).toBeNull()
    expect(resolveMuxFrameThumbnailUrl("   ")).toBeNull()
  })
})

describe("resolveMuxHeroPosterUrlAtMaxWidth", () => {
  it("emits the derivative the watch hero already requests, byte for byte", () => {
    // Mux caches per exact URL, so parameter ORDER is part of the cache key:
    // HeroPlayer's image loader sets `width` on a src that already carries
    // `time`, which lands time-first. Diverging here would mean a second,
    // cold derivative of the same frame.
    expect(resolveMuxHeroPosterUrlAtMaxWidth("abc123")).toBe(
      "https://image.mux.com/abc123/thumbnail.webp?time=2&width=1280",
    )
    expect(MUX_HERO_POSTER_MAX_WIDTH).toBe(1280)
  })

  it("returns null without a playback id", () => {
    expect(resolveMuxHeroPosterUrlAtMaxWidth(null)).toBeNull()
    expect(resolveMuxHeroPosterUrlAtMaxWidth(undefined)).toBeNull()
    expect(resolveMuxHeroPosterUrlAtMaxWidth("   ")).toBeNull()
  })

  it("encodes the playback id", () => {
    expect(resolveMuxHeroPosterUrlAtMaxWidth("a/b?c")).toContain("a%2Fb%3Fc")
  })
})

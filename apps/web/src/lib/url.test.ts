import { describe, expect, it } from "vitest"

import { resolveDownloadPosterUrl, resolveMuxFrameThumbnailUrl } from "./url"

describe("resolveDownloadPosterUrl", () => {
  it("requests a high-resolution Mux frame for the full-width modal", () => {
    expect(resolveDownloadPosterUrl(null, " playback/id ")).toBe(
      "https://image.mux.com/playback%2Fid/thumbnail.jpg?width=1280&height=720&fit_mode=smartcrop&time=2",
    )
  })

  it("requests a high-resolution Cloudflare editorial derivative without Mux", () => {
    expect(
      resolveDownloadPosterUrl(
        {
          mobileCinematicHigh:
            "https://imagedelivery.net/account/poster.jpg/f=jpg,w=120,h=68,q=95",
        },
        "   ",
      ),
    ).toBe(
      "https://imagedelivery.net/account/poster.jpg/f=jpg,w=1280,h=720,q=95",
    )
  })

  it("preserves non-Cloudflare editorial poster URLs without Mux", () => {
    expect(
      resolveDownloadPosterUrl(
        { mobileCinematicHigh: "https://cdn.test/editorial-high.jpg" },
        null,
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

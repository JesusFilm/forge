import { describe, expect, it } from "vitest"

import {
  BLURRED_BACKDROP_MAX_WIDTH,
  resolveBlurredBackdropUrl,
  resolveMuxFrameThumbnailUrl,
} from "./url"

describe("resolveBlurredBackdropUrl", () => {
  // The production shape: this is the exact transformation string admin's
  // authored artwork arrives with, and the one that made the live English
  // /videos page download 27.1 MB of blurred backdrops.
  const authored =
    "https://imagedelivery.net/tMY86qEHFACTO8_0kAeRFA/4e98172e-d6be-46c2-8173-f17a983fe000/f=jpg,w=1280,h=600,q=95"

  it("shrinks an authored Cloudflare Images backdrop to the blur-sized derivative", () => {
    expect(resolveBlurredBackdropUrl(authored)).toBe(
      "https://imagedelivery.net/tMY86qEHFACTO8_0kAeRFA/4e98172e-d6be-46c2-8173-f17a983fe000/f=jpg,w=128,h=60,q=50",
    )
  })

  // The crop Cloudflare applies is a function of the requested ratio, so a
  // rewrite that changed it would move the visible part of the artwork.
  it("preserves the source aspect ratio", () => {
    const widened = authored.replace("w=1280,h=600", "w=1600,h=900")
    const result = resolveBlurredBackdropUrl(widened) ?? ""
    expect(result).toContain(`w=${BLURRED_BACKDROP_MAX_WIDTH}`)
    expect(result).toContain("h=72")
  })

  it("adds a quality cap when the source carries none", () => {
    expect(
      resolveBlurredBackdropUrl(
        "https://imagedelivery.net/acct/id/f=jpg,w=1280,h=600",
      ),
    ).toBe("https://imagedelivery.net/acct/id/f=jpg,w=128,h=60,q=50")
  })

  // A Mux frame is already the single 448x252 derivative admin pre-generates.
  // A bespoke width there is a cold on-demand render, so this must be a no-op
  // — and it is the OTHER source this backdrop is actually handed in
  // production, not a hypothetical.
  it("leaves a Mux frame thumbnail untouched", () => {
    const frame = resolveMuxFrameThumbnailUrl("playback-id")
    expect(frame).not.toBeNull()
    expect(resolveBlurredBackdropUrl(frame)).toBe(frame)
  })

  it("leaves an unrecognized host untouched", () => {
    expect(resolveBlurredBackdropUrl("https://cdn.test/artwork.jpg")).toBe(
      "https://cdn.test/artwork.jpg",
    )
  })

  it("leaves a Cloudflare URL with no width/height transformation untouched", () => {
    expect(
      resolveBlurredBackdropUrl("https://imagedelivery.net/acct/id/public"),
    ).toBe("https://imagedelivery.net/acct/id/public")
  })

  // Never upscale: a source already at or below the cap would come back larger
  // than it started.
  it("leaves a source already narrower than the cap untouched", () => {
    const small = "https://imagedelivery.net/acct/id/f=jpg,w=64,h=30,q=95"
    expect(resolveBlurredBackdropUrl(small)).toBe(small)
  })

  it("returns null for an absent url and passes an unparseable one through", () => {
    expect(resolveBlurredBackdropUrl(null)).toBeNull()
    expect(resolveBlurredBackdropUrl(undefined)).toBeNull()
    expect(resolveBlurredBackdropUrl("")).toBeNull()
    expect(resolveBlurredBackdropUrl("not a url")).toBe("not a url")
  })
})

import { pickThumbnailUrl } from "../categoryThumbnail"

describe("pickThumbnailUrl", () => {
  it("returns the first result's resolved image when it has one", () => {
    expect(
      pickThumbnailUrl([
        { imageUrl: "https://image.mux.com/abc/thumbnail.jpg" },
        { imageUrl: "https://image.mux.com/def/thumbnail.jpg" },
      ]),
    ).toBe("https://image.mux.com/abc/thumbnail.jpg")
  })

  it("skips an imageless top hit and uses the next result with art (christmas)", () => {
    // "christmas" → results[0] 'The Hope of Christmas' has imageUrl: null; the
    // next result carries the artwork the card should blur behind. This scan is
    // the whole reason the helper doesn't just read results[0].
    expect(
      pickThumbnailUrl([
        { imageUrl: null },
        { imageUrl: "https://img/unexpected-christmas.jpg" },
      ]),
    ).toBe("https://img/unexpected-christmas.jpg")
  })

  it("tolerates null result entries while scanning", () => {
    expect(
      pickThumbnailUrl([
        null,
        { imageUrl: undefined },
        { imageUrl: "https://img/c.jpg" },
      ]),
    ).toBe("https://img/c.jpg")
  })

  // Variant-bearing Cloudflare urls are what admin actually returns for these
  // cards; a variant-less bare url 400s, so the suffix must survive intact.
  it("keeps a variant-bearing Cloudflare url intact", () => {
    const url =
      "https://imagedelivery.net/tMY86qEHFACTO8_0kAeRFA/Christmas2018.mobileCinematicHigh.jpg/f=jpg,w=1280,h=600,q=95"
    expect(pickThumbnailUrl([{ imageUrl: url }])).toBe(url)
  })

  it("drops results whose imageUrl fails URL validation (non-http scheme)", () => {
    expect(
      pickThumbnailUrl([
        { imageUrl: "javascript:alert(1)" },
        { imageUrl: "https://img/ok.jpg" },
      ]),
    ).toBe("https://img/ok.jpg")
  })

  it("returns null when no result has a usable image", () => {
    expect(pickThumbnailUrl([{ imageUrl: null }, null])).toBeNull()
    expect(pickThumbnailUrl([])).toBeNull()
  })

  it("returns null for missing data", () => {
    expect(pickThumbnailUrl(null)).toBeNull()
    expect(pickThumbnailUrl(undefined)).toBeNull()
  })
})

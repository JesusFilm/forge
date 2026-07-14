import { pickThumbnailUrl } from "./categoryThumbnail"

const wrap = (results: ({ imageUrl?: string | null } | null)[]) => ({
  semanticSearch: { results },
})

describe("pickThumbnailUrl", () => {
  it("returns the first result's resolved image when it has one", () => {
    expect(pickThumbnailUrl(wrap([{ imageUrl: "https://img/a.jpg" }]))).toBe(
      "https://img/a.jpg",
    )
  })

  it("skips an imageless top hit and uses the next result with art (christmas)", () => {
    // "christmas" → results[0] 'The Hope of Christmas' has imageUrl: null; the
    // next result carries the artwork the card should blur behind.
    expect(
      pickThumbnailUrl(
        wrap([
          { imageUrl: null },
          { imageUrl: "https://img/unexpected-christmas.jpg" },
        ]),
      ),
    ).toBe("https://img/unexpected-christmas.jpg")
  })

  it("tolerates null result entries while scanning", () => {
    expect(
      pickThumbnailUrl(
        wrap([null, { imageUrl: null }, { imageUrl: "https://img/c.jpg" }]),
      ),
    ).toBe("https://img/c.jpg")
  })

  it("returns null when no result has a usable image", () => {
    expect(pickThumbnailUrl(wrap([{ imageUrl: null }, null]))).toBeNull()
    expect(pickThumbnailUrl(wrap([]))).toBeNull()
  })

  it("returns null for missing/oddly-shaped data", () => {
    expect(pickThumbnailUrl(null)).toBeNull()
    expect(pickThumbnailUrl(undefined)).toBeNull()
    expect(pickThumbnailUrl({})).toBeNull()
    expect(pickThumbnailUrl({ semanticSearch: null })).toBeNull()
  })

  it("drops results whose imageUrl fails URL validation (non-http scheme)", () => {
    expect(
      pickThumbnailUrl(
        wrap([
          { imageUrl: "javascript:alert(1)" },
          { imageUrl: "https://img/ok.jpg" },
        ]),
      ),
    ).toBe("https://img/ok.jpg")
  })
})

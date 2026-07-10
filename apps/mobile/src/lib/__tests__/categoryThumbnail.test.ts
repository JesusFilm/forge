import { pickThumbnailUrl } from "../categoryThumbnail"

describe("pickThumbnailUrl", () => {
  it("returns the first result's absolute image url", () => {
    const data = {
      search: {
        results: [
          { imageUrl: "https://image.mux.com/abc/thumbnail.jpg" },
          { imageUrl: "https://image.mux.com/def/thumbnail.jpg" },
        ],
      },
    }
    expect(pickThumbnailUrl(data)).toBe(
      "https://image.mux.com/abc/thumbnail.jpg",
    )
  })

  it("returns null when there are no results", () => {
    expect(pickThumbnailUrl({ search: { results: [] } })).toBeNull()
  })

  it("returns null when the first result has no image", () => {
    const data = { search: { results: [{ imageUrl: null }] } }
    expect(pickThumbnailUrl(data)).toBeNull()
  })

  it("returns null for malformed or empty data", () => {
    expect(pickThumbnailUrl(null)).toBeNull()
    expect(pickThumbnailUrl(undefined)).toBeNull()
    expect(pickThumbnailUrl({})).toBeNull()
  })
})

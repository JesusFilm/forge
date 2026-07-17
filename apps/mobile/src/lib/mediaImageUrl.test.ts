import { rewriteSeedPosterUrl } from "./mediaImageUrl"

describe("rewriteSeedPosterUrl", () => {
  it("rewrites a www jesusfilm.org /images seed to the watch origin", () => {
    expect(
      rewriteSeedPosterUrl(
        "https://www.jesusfilm.org/images/thumbnails/1_jf-0-0-vertical.png",
      ),
    ).toBe(
      "https://watch.jesusfilm.org/watch/images/thumbnails/1_jf-0-0-vertical.png",
    )
  })

  it("rewrites a no-www seed too", () => {
    expect(
      rewriteSeedPosterUrl("https://jesusfilm.org/images/thumbnails/x.png"),
    ).toBe("https://watch.jesusfilm.org/watch/images/thumbnails/x.png")
  })

  it("leaves a non-/images jesusfilm path unchanged (rewrite boundary)", () => {
    expect(rewriteSeedPosterUrl("https://www.jesusfilm.org/videos/x.png")).toBe(
      "https://www.jesusfilm.org/videos/x.png",
    )
  })

  it("passes a non-jesusfilm URL through unchanged", () => {
    expect(rewriteSeedPosterUrl("https://cdn.example/poster.jpg")).toBe(
      "https://cdn.example/poster.jpg",
    )
  })

  it("returns null for null/undefined/empty", () => {
    expect(rewriteSeedPosterUrl(null)).toBeNull()
    expect(rewriteSeedPosterUrl(undefined)).toBeNull()
    expect(rewriteSeedPosterUrl("")).toBeNull()
  })
})

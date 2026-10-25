import { describe, expect, it } from "vitest"
import { resolveMediaImageUrl } from "./media-image-url"

const BASE_PATH = "/watch"

describe("resolveMediaImageUrl", () => {
  it("returns null for null input", () => {
    expect(resolveMediaImageUrl(null)).toBeNull()
  })

  describe("jesusfilm.org rewrite", () => {
    it("rewrites https://www.jesusfilm.org/images/* to basePath-relative", () => {
      expect(
        resolveMediaImageUrl(
          "https://www.jesusfilm.org/images/thumbnails/1_jf-0-0-vertical.png",
        ),
      ).toBe(`${BASE_PATH}/images/thumbnails/1_jf-0-0-vertical.png`)
    })

    it("rewrites https://jesusfilm.org/images/* (no www) to basePath-relative", () => {
      expect(resolveMediaImageUrl("https://jesusfilm.org/images/foo.png")).toBe(
        `${BASE_PATH}/images/foo.png`,
      )
    })

    it("rewrites http://www.jesusfilm.org/images/* (http scheme) to basePath-relative", () => {
      expect(
        resolveMediaImageUrl("http://www.jesusfilm.org/images/bar.png"),
      ).toBe(`${BASE_PATH}/images/bar.png`)
    })

    it("rewrites uppercase HTTPS://jesusfilm.org/images/* (case-insensitive)", () => {
      expect(
        resolveMediaImageUrl("HTTPS://www.jesusfilm.org/images/baz.png"),
      ).toBe(`${BASE_PATH}/images/baz.png`)
    })

    it("does not rewrite jesusfilm.org paths outside /images/", () => {
      expect(
        resolveMediaImageUrl("https://www.jesusfilm.org/watch/easter"),
      ).toBe("https://www.jesusfilm.org/watch/easter")
    })

    it("does not match suffix-attached lookalike domains", () => {
      // Anchor `$` on the path capture means the host must end at `jesusfilm.org`
      // — `jesusfilm.org.evil.com` is rejected because `.evil.com` would have
      // to live inside the captured path segment, which starts with `/images/`.
      expect(
        resolveMediaImageUrl("https://jesusfilm.org.evil.com/images/steal.png"),
      ).toBe("https://jesusfilm.org.evil.com/images/steal.png")
    })
  })

  describe("absolute URLs (non-jesusfilm.org)", () => {
    it("passes through https:// CDN URLs unchanged", () => {
      const url =
        "https://imagedelivery.net/account/abc/mobileCinematicHigh.jpg"
      expect(resolveMediaImageUrl(url)).toBe(url)
    })

    it("passes through http:// URLs unchanged", () => {
      const url = "http://example.com/poster.png"
      expect(resolveMediaImageUrl(url)).toBe(url)
    })
  })

  describe("relative paths", () => {
    it("passes through paths already prefixed with basePath", () => {
      expect(resolveMediaImageUrl("/watch/foo/bar.png")).toBe(
        "/watch/foo/bar.png",
      )
    })

    it("prefixes /images/ paths with basePath", () => {
      expect(resolveMediaImageUrl("/images/foo.png")).toBe(
        "/watch/images/foo.png",
      )
    })

    it("returns other relative paths unchanged (no basePath prefix)", () => {
      expect(resolveMediaImageUrl("/some/other/path.png")).toBe(
        "/some/other/path.png",
      )
    })
  })
})

import { describe, expect, it } from "vitest"

import {
  isAdminMuxCardThumbnail,
  isMuxImageUrl,
  muxImageLoader,
} from "./provider-image"

describe("isMuxImageUrl", () => {
  it("accepts only HTTPS image.mux.com URLs", () => {
    expect(isMuxImageUrl("https://image.mux.com/playback/thumbnail.jpg")).toBe(
      true,
    )
    expect(isMuxImageUrl("http://image.mux.com/playback/thumbnail.jpg")).toBe(
      false,
    )
    expect(
      isMuxImageUrl("https://imagedelivery.net/account/image/public"),
    ).toBe(false)
  })

  it.each([
    "https://example.com/image.jpg",
    "https://evilmux.com/image.jpg",
    "https://image.mux.com.evil.com/image.jpg",
    "https://image.mux.com@evil.com/image.jpg",
    "http://image.mux.com/playback/thumbnail.jpg",
    "/local-image.jpg",
    "not a URL",
  ])("keeps Next optimization for other URLs: %s", (src) => {
    expect(isMuxImageUrl(src)).toBe(false)
  })
})

describe("muxImageLoader", () => {
  it("uses responsive WebP dimensions while preserving the source aspect ratio", () => {
    expect(
      muxImageLoader({
        src: "https://image.mux.com/playback/thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2",
        width: 640,
      }),
    ).toBe(
      "https://image.mux.com/playback/thumbnail.webp?width=640&height=360&fit_mode=smartcrop&time=2",
    )
  })

  it("adds responsive width and WebP format when source dimensions are absent", () => {
    expect(
      muxImageLoader({
        src: "https://image.mux.com/playback/thumbnail.jpg",
        width: 320,
      }),
    ).toBe("https://image.mux.com/playback/thumbnail.webp?width=320")
  })
})

describe("isAdminMuxCardThumbnail", () => {
  it("recognizes Admin's exact pre-generated thumbnail URL", () => {
    expect(
      isAdminMuxCardThumbnail(
        "https://image.mux.com/playback-id/thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2",
      ),
    ).toBe(true)
  })

  it("rejects any URL that would create a different Mux render", () => {
    expect(
      isAdminMuxCardThumbnail(
        "https://image.mux.com/playback-id/thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=3",
      ),
    ).toBe(false)
  })
})

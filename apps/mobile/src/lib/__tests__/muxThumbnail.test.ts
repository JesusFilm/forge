import { deriveMuxThumbnailUrl } from "../muxThumbnail"

describe("deriveMuxThumbnailUrl", () => {
  it("extracts playback ID from standard Mux HLS URL", () => {
    const url =
      "https://stream.mux.com/x3XKV1Yi01z7dyF6f8ZLBMNrHtNWS02iHoQw6vIcf4hBw.m3u8"
    const result = deriveMuxThumbnailUrl(url)
    expect(result).toBe(
      "https://image.mux.com/x3XKV1Yi01z7dyF6f8ZLBMNrHtNWS02iHoQw6vIcf4hBw/thumbnail.png?width=1280&fit_mode=smartcrop",
    )
  })

  it("returns null for null input", () => {
    expect(deriveMuxThumbnailUrl(null)).toBeNull()
  })

  it("returns null for undefined input", () => {
    expect(deriveMuxThumbnailUrl(undefined)).toBeNull()
  })

  it("returns null for non-Mux URL", () => {
    expect(deriveMuxThumbnailUrl("https://example.com/video.m3u8")).toBeNull()
  })

  it("returns null for empty string", () => {
    expect(deriveMuxThumbnailUrl("")).toBeNull()
  })
})

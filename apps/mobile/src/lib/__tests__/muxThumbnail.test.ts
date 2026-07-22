import {
  deriveMuxThumbnailUrl,
  extractMuxPlaybackId,
  muxHlsUrlFromPlaybackId,
  muxThumbnailFromPlaybackId,
} from "../muxThumbnail"

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

describe("muxHlsUrlFromPlaybackId", () => {
  it("builds the canonical HLS URL from a clean token", () => {
    expect(muxHlsUrlFromPlaybackId("abc123XYZ")).toBe(
      "https://stream.mux.com/abc123XYZ.m3u8",
    )
  })

  it("returns null for a token with non-alphanumeric characters", () => {
    expect(muxHlsUrlFromPlaybackId("evil.com/x")).toBeNull()
    expect(muxHlsUrlFromPlaybackId("ab cd")).toBeNull()
  })

  it("returns null for null / undefined / empty", () => {
    expect(muxHlsUrlFromPlaybackId(null)).toBeNull()
    expect(muxHlsUrlFromPlaybackId(undefined)).toBeNull()
    expect(muxHlsUrlFromPlaybackId("")).toBeNull()
  })
})

describe("muxThumbnailFromPlaybackId", () => {
  it("builds the smartcrop thumbnail URL from a clean token", () => {
    expect(muxThumbnailFromPlaybackId("abc123XYZ")).toBe(
      "https://image.mux.com/abc123XYZ/thumbnail.png?width=1280&fit_mode=smartcrop",
    )
  })

  it("returns null for a token with non-alphanumeric characters (no injection)", () => {
    expect(muxThumbnailFromPlaybackId("evil.com/x")).toBeNull()
    expect(muxThumbnailFromPlaybackId("ab cd")).toBeNull()
  })

  it("returns null for null / undefined / empty", () => {
    expect(muxThumbnailFromPlaybackId(null)).toBeNull()
    expect(muxThumbnailFromPlaybackId(undefined)).toBeNull()
    expect(muxThumbnailFromPlaybackId("")).toBeNull()
  })
})

describe("extractMuxPlaybackId", () => {
  it("extracts the playback ID from a Mux HLS URL", () => {
    expect(extractMuxPlaybackId("https://stream.mux.com/abc123.m3u8")).toBe(
      "abc123",
    )
  })

  it("returns null for a non-Mux URL", () => {
    expect(extractMuxPlaybackId("https://example.com/video.m3u8")).toBeNull()
  })

  it("returns null for null / undefined", () => {
    expect(extractMuxPlaybackId(null)).toBeNull()
    expect(extractMuxPlaybackId(undefined)).toBeNull()
  })

  it("matches the ID that builds back to the same URL", () => {
    const url = "https://stream.mux.com/abc123XYZ.m3u8"
    const id = extractMuxPlaybackId(url)
    expect(id).not.toBeNull()
    expect(muxHlsUrlFromPlaybackId(id)).toBe(url)
  })
})

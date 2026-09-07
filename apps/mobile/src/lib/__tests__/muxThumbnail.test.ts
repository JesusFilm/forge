import {
  muxAnimatedPreviewFromPlaybackId,
  deriveMuxThumbnailUrl,
  extractMuxPlaybackId,
  isSameMuxAsset,
  muxHlsUrlFromPlaybackId,
  muxThumbnailFromPlaybackId,
} from "../muxThumbnail"

describe("deriveMuxThumbnailUrl", () => {
  it("extracts playback ID from standard Mux HLS URL", () => {
    const url =
      "https://stream.mux.com/x3XKV1Yi01z7dyF6f8ZLBMNrHtNWS02iHoQw6vIcf4hBw.m3u8"
    const result = deriveMuxThumbnailUrl(url)
    expect(result).toBe(
      "https://image.mux.com/x3XKV1Yi01z7dyF6f8ZLBMNrHtNWS02iHoQw6vIcf4hBw/thumbnail.webp?width=1280&height=720&fit_mode=smartcrop",
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
      "https://image.mux.com/abc123XYZ/thumbnail.webp?width=1280&height=720&fit_mode=smartcrop",
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

describe("isSameMuxAsset", () => {
  it("matches two URL shapes that carry the same playback id", () => {
    // Seed URL vs resolved variant: same asset, different string.
    expect(
      isSameMuxAsset(
        "https://stream.mux.com/abc123XYZ.m3u8",
        "https://stream.mux.com/abc123XYZ.m3u8?redundant_streams=true",
      ),
    ).toBe(true)
  })

  it("rejects different playback ids", () => {
    expect(
      isSameMuxAsset(
        "https://stream.mux.com/abc123.m3u8",
        "https://stream.mux.com/def456.m3u8",
      ),
    ).toBe(false)
  })

  it("rejects null on either side", () => {
    expect(isSameMuxAsset(null, "https://stream.mux.com/abc123.m3u8")).toBe(
      false,
    )
    expect(isSameMuxAsset("https://stream.mux.com/abc123.m3u8", null)).toBe(
      false,
    )
    expect(isSameMuxAsset(null, null)).toBe(false)
  })

  it("rejects non-Mux URLs, even two identical ones", () => {
    expect(
      isSameMuxAsset(
        "https://example.com/video.m3u8",
        "https://stream.mux.com/abc123.m3u8",
      ),
    ).toBe(false)
    expect(
      isSameMuxAsset(
        "https://example.com/video.m3u8",
        "https://example.com/video.m3u8",
      ),
    ).toBe(false)
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

describe("muxAnimatedPreviewFromPlaybackId", () => {
  // Byte-for-byte: the 448/8 params are shared with apps/tv and apps/web so all
  // three ride one warm Mux CDN entry. A novel size is a cold transcode.
  it("builds the shared animated-preview URL", () => {
    expect(muxAnimatedPreviewFromPlaybackId("abc123XYZ")).toBe(
      "https://image.mux.com/abc123XYZ/animated.webp?start=2&end=6&width=448&fps=8",
    )
  })

  // The id is admin-supplied, so it is validated before interpolation or a
  // tainted value could redirect the request to another host or path.
  it.each(["evil.com/x", "ab cd", "a/../b", "a?b=1", "a#f"])(
    "returns null for a non-alphanumeric id (%s)",
    (id) => {
      expect(muxAnimatedPreviewFromPlaybackId(id)).toBeNull()
    },
  )

  it("returns null for a missing id", () => {
    expect(muxAnimatedPreviewFromPlaybackId(null)).toBeNull()
    expect(muxAnimatedPreviewFromPlaybackId(undefined)).toBeNull()
    expect(muxAnimatedPreviewFromPlaybackId("")).toBeNull()
  })
})

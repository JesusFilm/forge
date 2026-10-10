import {
  EXPERIENCE_CARD_PREVIEW_OPTS,
  extractMuxPlaybackId,
  getMuxAnimatedPreviewUrl,
  muxHlsUrlFromPlaybackId,
} from "./muxUrl"

describe("muxHlsUrlFromPlaybackId", () => {
  it("builds the canonical HLS URL from a clean token", () => {
    expect(muxHlsUrlFromPlaybackId("abc123XYZ")).toBe(
      "https://stream.mux.com/abc123XYZ.m3u8",
    )
  })

  it("accepts the - and _ characters Mux uses in playback ids", () => {
    expect(muxHlsUrlFromPlaybackId("x3XKV1Yi01z-dyF_8ZLBM")).toBe(
      "https://stream.mux.com/x3XKV1Yi01z-dyF_8ZLBM.m3u8",
    )
  })

  it("returns null for a token with unsafe characters (no host/path injection)", () => {
    expect(muxHlsUrlFromPlaybackId("evil.com/x")).toBeNull()
    expect(muxHlsUrlFromPlaybackId("ab cd")).toBeNull()
  })

  it("returns null for null / undefined / empty", () => {
    expect(muxHlsUrlFromPlaybackId(null)).toBeNull()
    expect(muxHlsUrlFromPlaybackId(undefined)).toBeNull()
    expect(muxHlsUrlFromPlaybackId("")).toBeNull()
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

  it("returns null when stream.mux.com is embedded in a non-Mux host's path", () => {
    // Host-anchor: an unanchored substring match would falsely extract "abc"
    // here. The real hostname is evil.com, so this must be rejected.
    expect(
      extractMuxPlaybackId("https://evil.com/stream.mux.com/abc.m3u8"),
    ).toBeNull()
  })

  it("still extracts the id from a genuine Mux URL", () => {
    expect(extractMuxPlaybackId("https://stream.mux.com/abc123.m3u8")).toBe(
      "abc123",
    )
  })

  it("returns null for a non-URL string", () => {
    expect(extractMuxPlaybackId("not a url")).toBeNull()
  })

  it("returns null for null / undefined / empty", () => {
    expect(extractMuxPlaybackId(null)).toBeNull()
    expect(extractMuxPlaybackId(undefined)).toBeNull()
    expect(extractMuxPlaybackId("")).toBeNull()
  })

  it("round-trips: a Mux URL → id → URL yields the same URL", () => {
    const url = "https://stream.mux.com/x3XKV1Yi01z7dyF6f8ZLBMNrHtNWS02i.m3u8"
    const id = extractMuxPlaybackId(url)
    expect(id).not.toBeNull()
    expect(muxHlsUrlFromPlaybackId(id)).toBe(url)
  })
})

describe("getMuxAnimatedPreviewUrl", () => {
  it("builds the animated.webp URL with web-matched defaults (warm Mux cache)", () => {
    expect(getMuxAnimatedPreviewUrl("abc123XYZ")).toBe(
      "https://image.mux.com/abc123XYZ/animated.webp?start=2&end=6&width=448&fps=8",
    )
  })

  it("accepts the - and _ characters Mux uses in playback ids", () => {
    expect(getMuxAnimatedPreviewUrl("x3XKV1Yi01z-dyF_8ZLBM")).toBe(
      "https://image.mux.com/x3XKV1Yi01z-dyF_8ZLBM/animated.webp?start=2&end=6&width=448&fps=8",
    )
  })

  it("builds the experience-card HD preview (Mux max 640/30, cold ~5s)", () => {
    // 640 is Mux's animated-width ceiling (1280 → HTTP 400 "Invalid width");
    // the warm default stays 448/8 so rail cards remain instant.
    expect(
      getMuxAnimatedPreviewUrl("abc123XYZ", EXPERIENCE_CARD_PREVIEW_OPTS),
    ).toBe(
      "https://image.mux.com/abc123XYZ/animated.webp?start=2&end=6&width=640&fps=30",
    )
    expect(EXPERIENCE_CARD_PREVIEW_OPTS).toEqual({ width: 640, fps: 30 })
  })

  it("applies opts overrides (spike/test seam) without touching other params", () => {
    expect(getMuxAnimatedPreviewUrl("abc", { width: 320, fps: 30 })).toBe(
      "https://image.mux.com/abc/animated.webp?start=2&end=6&width=320&fps=30",
    )
  })

  it("trims surrounding whitespace before validating", () => {
    expect(getMuxAnimatedPreviewUrl("  abc123  ")).toBe(
      "https://image.mux.com/abc123/animated.webp?start=2&end=6&width=448&fps=8",
    )
  })

  it("returns null for a token with unsafe characters (no host/path injection)", () => {
    expect(getMuxAnimatedPreviewUrl("evil.com/x")).toBeNull()
    expect(getMuxAnimatedPreviewUrl("ab cd")).toBeNull()
  })

  it("returns null for null / undefined / empty / whitespace-only", () => {
    expect(getMuxAnimatedPreviewUrl(null)).toBeNull()
    expect(getMuxAnimatedPreviewUrl(undefined)).toBeNull()
    expect(getMuxAnimatedPreviewUrl("")).toBeNull()
    expect(getMuxAnimatedPreviewUrl("   ")).toBeNull()
  })
})

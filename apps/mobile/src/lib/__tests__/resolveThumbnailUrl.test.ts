import { resolveThumbnailUrl } from "../resolveThumbnailUrl"

const MUX_HLS =
  "https://stream.mux.com/x3XKV1Yi01z7dyF6f8ZLBMNrHtNWS02iHoQw6vIcf4hBw.m3u8"
const MUX_THUMB =
  "https://image.mux.com/x3XKV1Yi01z7dyF6f8ZLBMNrHtNWS02iHoQw6vIcf4hBw/thumbnail.png?width=1280&fit_mode=smartcrop"

describe("resolveThumbnailUrl", () => {
  it("returns a provided https thumbnail unchanged", () => {
    expect(resolveThumbnailUrl("https://cdn.example.com/a.jpg")).toBe(
      "https://cdn.example.com/a.jpg",
    )
  })

  it("prefers the provided thumbnail over the Mux fallback", () => {
    expect(resolveThumbnailUrl("https://cdn.example.com/a.jpg", MUX_HLS)).toBe(
      "https://cdn.example.com/a.jpg",
    )
  })

  it("derives the Mux thumbnail when only a stream is given", () => {
    expect(resolveThumbnailUrl(null, MUX_HLS)).toBe(MUX_THUMB)
  })

  it("does not derive a Mux thumbnail when streamingUrl is omitted", () => {
    expect(resolveThumbnailUrl(null)).toBeNull()
  })

  it("returns null when neither a thumbnail nor a Mux stream resolves", () => {
    expect(
      resolveThumbnailUrl(null, "https://example.com/video.m3u8"),
    ).toBeNull()
  })

  it("returns null for a nullish thumbnail with no stream", () => {
    expect(resolveThumbnailUrl(undefined)).toBeNull()
  })
})

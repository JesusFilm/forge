import { describe, expect, it } from "vitest"

import {
  resolveEpisodeImageUrl,
  resolveEpisodeThumbnail,
} from "./episode-image"

describe("resolveEpisodeImageUrl", () => {
  it("prefers authored artwork in the historical 4-tier order", () => {
    expect(
      resolveEpisodeImageUrl({
        images: [
          {
            mobileCinematicHigh: "https://cdn.test/high.jpg",
            thumbnail: "https://cdn.test/thumb.jpg",
            mobileCinematicLow: "https://cdn.test/low.jpg",
            url: "https://cdn.test/url.jpg",
          },
        ],
        muxPlaybackId: "playback-id",
      }),
    ).toBe("https://cdn.test/high.jpg")

    expect(
      resolveEpisodeImageUrl({
        images: [{ url: "https://cdn.test/url.jpg" }],
        muxPlaybackId: "playback-id",
      }),
    ).toBe("https://cdn.test/url.jpg")
  })

  // The production shape this fixes: newer vertical series ship episodes with
  // no video_image row at all, so every card previously rendered as an empty
  // stone tile even though the episode was playable.
  it("falls back to a Mux frame when the episode has no image row", () => {
    expect(
      resolveEpisodeImageUrl({ images: [], muxPlaybackId: "playback-id" }),
    ).toBe(
      "https://image.mux.com/playback-id/thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2",
    )
    expect(resolveEpisodeImageUrl({ muxPlaybackId: "playback-id" })).toBe(
      "https://image.mux.com/playback-id/thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2",
    )
  })

  // An image row that exists but carries only blank/null fields is a distinct
  // shape from "no row at all" and must reach the Mux tier too.
  it("falls back to a Mux frame when the image row carries no usable field", () => {
    expect(
      resolveEpisodeImageUrl({
        images: [{ mobileCinematicHigh: null, thumbnail: null, url: null }],
        muxPlaybackId: "playback-id",
      }),
    ).toBe(
      "https://image.mux.com/playback-id/thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2",
    )
  })

  // Admin's VideoImage resolver passes stored columns through raw, so a
  // present-but-blank field is a real production shape. Under `??` it counts
  // as a hit: the card would render src="" AND the Mux tier below would never
  // run, reproducing the very empty tile this fallback exists to remove.
  it("treats blank authored fields as absent and reaches the Mux tier", () => {
    expect(
      resolveEpisodeImageUrl({
        images: [{ mobileCinematicHigh: "", thumbnail: "", url: "" }],
        muxPlaybackId: "playback-id",
      }),
    ).toBe(
      "https://image.mux.com/playback-id/thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2",
    )
  })

  it("skips a blank higher tier in favour of a populated lower one", () => {
    expect(
      resolveEpisodeImageUrl({
        images: [
          { mobileCinematicHigh: "", thumbnail: "https://cdn.test/t.jpg" },
        ],
      }),
    ).toBe("https://cdn.test/t.jpg")
  })

  it("returns null when there is neither artwork nor playback", () => {
    expect(
      resolveEpisodeImageUrl({ images: [], muxPlaybackId: null }),
    ).toBeNull()
    expect(resolveEpisodeImageUrl({})).toBeNull()
  })
})

describe("resolveEpisodeThumbnail", () => {
  // The LQIP admin generates is derived from the same 448x252 recipe the frame
  // URL requests, so it is only meaningful when the Mux tier actually won.
  it("carries the Mux LQIP only when the frame is what renders", () => {
    expect(
      resolveEpisodeThumbnail({
        images: [],
        muxPlaybackId: "playback-id",
        muxThumbnailBlurDataUrl: "data:image/jpeg;base64,AAAA",
      }),
    ).toEqual({
      url: "https://image.mux.com/playback-id/thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2",
      blurDataUrl: "data:image/jpeg;base64,AAAA",
    })
  })

  it("withholds the Mux LQIP from authored artwork", () => {
    expect(
      resolveEpisodeThumbnail({
        images: [{ mobileCinematicHigh: "https://cdn.test/high.jpg" }],
        muxPlaybackId: "playback-id",
        muxThumbnailBlurDataUrl: "data:image/jpeg;base64,AAAA",
      }),
    ).toEqual({ url: "https://cdn.test/high.jpg", blurDataUrl: null })
  })

  it("withholds the LQIP when there is no frame to blur", () => {
    expect(
      resolveEpisodeThumbnail({
        images: [],
        muxPlaybackId: null,
        muxThumbnailBlurDataUrl: "data:image/jpeg;base64,AAAA",
      }),
    ).toEqual({ url: null, blurDataUrl: null })
  })
})

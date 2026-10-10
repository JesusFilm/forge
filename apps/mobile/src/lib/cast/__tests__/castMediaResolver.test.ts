import { toMediaLoadRequest } from "../castAdapter"
import {
  CAST_CONTENT_TYPE,
  resolveCastMedia,
  type CastMediaInput,
} from "../castMediaResolver"

const input = (overrides: Partial<CastMediaInput> = {}): CastMediaInput => ({
  activeVariant: { hls: "https://stream.mux.com/variant.m3u8" },
  video: { streamingUrl: "https://stream.mux.com/video.m3u8" },
  seedStreamingUrl: "https://stream.mux.com/seed.m3u8",
  title: "The Birth of Jesus",
  posterUrl: "https://images.example.org/poster.jpg",
  startPositionSeconds: 30,
  playbackRate: 1.5,
  ...overrides,
})

describe("resolveCastMedia", () => {
  it("prefers the active variant stream", () => {
    expect(resolveCastMedia(input())).toEqual({
      contentUrl: "https://stream.mux.com/variant.m3u8",
      contentType: "application/x-mpegURL",
      title: "The Birth of Jesus",
      posterUrl: "https://images.example.org/poster.jpg",
      startPositionSeconds: 30,
      playbackRate: 1.5,
    })
  })

  it("falls back to the video stream when there is no variant", () => {
    expect(resolveCastMedia(input({ activeVariant: null }))?.contentUrl).toBe(
      "https://stream.mux.com/video.m3u8",
    )
  })

  it("falls back to the video stream when the variant has a null hls", () => {
    expect(
      resolveCastMedia(input({ activeVariant: { hls: null } }))?.contentUrl,
    ).toBe("https://stream.mux.com/video.m3u8")
  })

  it("uses the seed stream in the seed-only window (variant and video null)", () => {
    expect(
      resolveCastMedia(input({ activeVariant: null, video: null }))?.contentUrl,
    ).toBe("https://stream.mux.com/seed.m3u8")
  })

  it("falls to the seed when the video has a null streamingUrl", () => {
    expect(
      resolveCastMedia(
        input({ activeVariant: null, video: { streamingUrl: null } }),
      )?.contentUrl,
    ).toBe("https://stream.mux.com/seed.m3u8")
  })

  it("returns null when every remote source is null", () => {
    expect(
      resolveCastMedia(
        input({ activeVariant: null, video: null, seedStreamingUrl: null }),
      ),
    ).toBeNull()
  })

  it("trims the trailing-newline taint prod dub hls can carry", () => {
    expect(
      resolveCastMedia(
        input({
          activeVariant: { hls: "https://stream.mux.com/variant.m3u8\n" },
        }),
      )?.contentUrl,
    ).toBe("https://stream.mux.com/variant.m3u8")
  })

  it("never emits a local file path — file: URLs resolve to null", () => {
    expect(
      resolveCastMedia(
        input({
          activeVariant: { hls: "file:///var/mobile/offline/jesus.m3u8" },
        }),
      ),
    ).toBeNull()
  })

  it("rejects non-https and garbage URLs a receiver cannot fetch", () => {
    expect(
      resolveCastMedia(
        input({ activeVariant: { hls: "http://stream.mux.com/v.m3u8" } }),
      ),
    ).toBeNull()
    expect(
      resolveCastMedia(input({ activeVariant: { hls: "not a url" } })),
    ).toBeNull()
  })

  it("an empty-string variant hls wins the ?? chain and yields null (screen parity)", () => {
    // The screen's chain only skips null/undefined; "" is unloadable there too.
    expect(resolveCastMedia(input({ activeVariant: { hls: "" } }))).toBeNull()
  })

  it("tolerates null title and poster", () => {
    const media = resolveCastMedia(input({ title: null, posterUrl: null }))
    expect(media?.title).toBeNull()
    expect(media?.posterUrl).toBeNull()
  })

  it("clamps missing, negative, and non-finite start positions to 0", () => {
    expect(
      resolveCastMedia(input({ startPositionSeconds: null }))
        ?.startPositionSeconds,
    ).toBe(0)
    expect(
      resolveCastMedia(input({ startPositionSeconds: -4 }))
        ?.startPositionSeconds,
    ).toBe(0)
    expect(
      resolveCastMedia(input({ startPositionSeconds: Number.NaN }))
        ?.startPositionSeconds,
    ).toBe(0)
  })

  it("always stamps the HLS contentType", () => {
    expect(resolveCastMedia(input())?.contentType).toBe(CAST_CONTENT_TYPE)
    expect(CAST_CONTENT_TYPE).toBe("application/x-mpegURL")
  })

  it("carries the session speed onto the media (R15/AE9)", () => {
    expect(resolveCastMedia(input({ playbackRate: 1.5 }))?.playbackRate).toBe(
      1.5,
    )
    expect(resolveCastMedia(input({ playbackRate: 1 }))?.playbackRate).toBe(1)
  })

  it("defaults null, non-finite, and out-of-range rates to 1", () => {
    expect(resolveCastMedia(input({ playbackRate: null }))?.playbackRate).toBe(
      1,
    )
    expect(
      resolveCastMedia(input({ playbackRate: Number.NaN }))?.playbackRate,
    ).toBe(1)
    expect(resolveCastMedia(input({ playbackRate: 2.5 }))?.playbackRate).toBe(1)
    expect(resolveCastMedia(input({ playbackRate: 0.25 }))?.playbackRate).toBe(
      1,
    )
  })
})

describe("toMediaLoadRequest (castAdapter mapping)", () => {
  const media = {
    contentUrl: "https://stream.mux.com/variant.m3u8",
    contentType: CAST_CONTENT_TYPE,
    title: "The Birth of Jesus",
    posterUrl: "https://images.example.org/poster.jpg",
    startPositionSeconds: 30,
    playbackRate: 1.5,
  } as const

  it("maps the resolved media onto the SDK load request (AE9)", () => {
    expect(toMediaLoadRequest(media)).toEqual({
      autoplay: true,
      startTime: 30,
      playbackRate: 1.5,
      mediaInfo: {
        contentUrl: "https://stream.mux.com/variant.m3u8",
        contentType: "application/x-mpegURL",
        streamType: "buffered",
        metadata: {
          type: "movie",
          title: "The Birth of Jesus",
          images: [{ url: "https://images.example.org/poster.jpg" }],
        },
      },
    })
  })

  it("carries a rate of 1 explicitly (pinned: carry, never omit)", () => {
    expect(toMediaLoadRequest({ ...media, playbackRate: 1 }).playbackRate).toBe(
      1,
    )
  })

  it("omits title and images when metadata is absent", () => {
    const request = toMediaLoadRequest({
      ...media,
      title: null,
      posterUrl: null,
    })
    expect(request.mediaInfo?.metadata).toEqual({ type: "movie" })
  })
})

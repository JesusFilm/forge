import { afterEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"

vi.mock("next/server", () => ({
  after: vi.fn((callback: () => unknown) => callback()),
}))

import {
  buildWatchChapterCarouselMuxLqipUrl,
  buildWatchChapterCarouselMuxThumbnailUrl,
  buildWatchHeroPosterMuxLqipUrl,
  buildWatchHeroPosterMuxThumbnailUrl,
  getOrCreateWatchChapterCarouselMuxBlurDataUrl,
  getOrCreateWatchHeroPosterMuxBlurDataUrl,
  getOrScheduleWatchChapterCarouselMuxBlurDataUrl,
} from "./mux-image-derivative.service"

function makePrisma({
  existingBlurDataUrl = null,
}: {
  existingBlurDataUrl?: string | null
} = {}): PrismaClient {
  const findUnique = vi.fn(async () =>
    existingBlurDataUrl
      ? { blurDataUrl: existingBlurDataUrl, dominantColor: "#123456" }
      : null,
  )
  const upsert = vi.fn(async (input: { create: { blurDataUrl: string } }) => ({
    blurDataUrl: input.create.blurDataUrl,
  }))

  return {
    muxImageDerivative: {
      findUnique,
      upsert,
    },
  } as unknown as PrismaClient
}

const svgBytes = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#336699"/></svg>',
)
const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svgBytes).toString("base64")}`

describe("mux-image-derivative.service", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("builds the chapter carousel full thumbnail and tiny LQIP URLs from the same crop recipe", () => {
    expect(buildWatchChapterCarouselMuxThumbnailUrl("playback id")).toBe(
      "https://image.mux.com/playback%20id/thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2",
    )
    expect(buildWatchChapterCarouselMuxLqipUrl("playback id")).toBe(
      "https://image.mux.com/playback%20id/thumbnail.jpg?width=24&height=14&fit_mode=smartcrop&time=2",
    )
  })

  it("builds the hero poster full thumbnail and tiny LQIP URLs without the carousel smart crop", () => {
    expect(buildWatchHeroPosterMuxThumbnailUrl("playback id")).toBe(
      "https://image.mux.com/playback%20id/thumbnail.webp?width=1280&time=2",
    )
    expect(buildWatchHeroPosterMuxLqipUrl("playback id")).toBe(
      "https://image.mux.com/playback%20id/thumbnail.webp?width=32&time=2",
    )
  })

  it("returns an existing stored blurDataURL without fetching Mux", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const prisma = makePrisma({
      existingBlurDataUrl: "data:image/jpeg;base64,stored",
    })

    await expect(
      getOrCreateWatchChapterCarouselMuxBlurDataUrl({
        prisma,
        muxVideoId: "mux-video-1",
        playbackId: "playback-1",
      }),
    ).resolves.toBe("data:image/jpeg;base64,stored")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("fetches the tiny Mux image, stores it as a Base64 data URL, and returns it", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: new Headers({ "content-type": "image/svg+xml" }),
      arrayBuffer: async () => svgBytes.buffer,
    }))
    vi.stubGlobal("fetch", fetchMock)
    const prisma = makePrisma()

    await expect(
      getOrCreateWatchChapterCarouselMuxBlurDataUrl({
        prisma,
        muxVideoId: "mux-video-1",
        playbackId: "playback-1",
      }),
    ).resolves.toBe(svgDataUrl)

    expect(fetchMock).toHaveBeenCalledWith(
      "https://image.mux.com/playback-1/thumbnail.jpg?width=24&height=14&fit_mode=smartcrop&time=2",
      expect.objectContaining({ redirect: "error" }),
    )

    expect(prisma.muxImageDerivative.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          muxVideoId: "mux-video-1",
          sourceUrl:
            "https://image.mux.com/playback-1/thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2",
          lqipUrl:
            "https://image.mux.com/playback-1/thumbnail.jpg?width=24&height=14&fit_mode=smartcrop&time=2",
          blurDataUrl: svgDataUrl,
          dominantColor: expect.stringMatching(/^#[0-9a-f]{6}$/i),
        }),
      }),
    )
  })

  it("returns null for a missing derivative and schedules generation in the background", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: new Headers({ "content-type": "image/svg+xml" }),
        arrayBuffer: async () => svgBytes.buffer,
      })),
    )
    const prisma = makePrisma()

    await expect(
      getOrScheduleWatchChapterCarouselMuxBlurDataUrl({
        prisma,
        muxVideoId: "mux-video-1",
        playbackId: "playback-1",
      }),
    ).resolves.toBeNull()

    await vi.waitFor(() => {
      expect(prisma.muxImageDerivative.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            muxVideoId: "mux-video-1",
            blurDataUrl: svgDataUrl,
            dominantColor: expect.stringMatching(/^#[0-9a-f]{6}$/i),
          }),
        }),
      )
    })
  })

  it("dedupes matching background generations", async () => {
    type FetchResponse = {
      ok: true
      headers: Headers
      arrayBuffer: () => Promise<ArrayBuffer>
    }
    let resolveFetch!: (value: FetchResponse) => void
    const fetchPromise = new Promise<FetchResponse>((resolve) => {
      resolveFetch = resolve
    })
    const fetchMock = vi.fn(() => fetchPromise)
    vi.stubGlobal("fetch", fetchMock)
    const prisma = makePrisma()

    await Promise.all([
      getOrScheduleWatchChapterCarouselMuxBlurDataUrl({
        prisma,
        muxVideoId: "mux-video-1",
        playbackId: "playback-1",
      }),
      getOrScheduleWatchChapterCarouselMuxBlurDataUrl({
        prisma,
        muxVideoId: "mux-video-1",
        playbackId: "playback-1",
      }),
    ])

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    resolveFetch({
      ok: true,
      headers: new Headers({ "content-type": "image/svg+xml" }),
      arrayBuffer: async () => svgBytes.buffer,
    })
    await vi.waitFor(() => {
      expect(prisma.muxImageDerivative.upsert).toHaveBeenCalledTimes(1)
    })
  })

  it("stores the hero poster blur under the hero recipe", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: new Headers({ "content-type": "image/svg+xml" }),
        arrayBuffer: async () => svgBytes.buffer,
      })),
    )
    const prisma = makePrisma()

    await expect(
      getOrCreateWatchHeroPosterMuxBlurDataUrl({
        prisma,
        muxVideoId: "mux-video-1",
        playbackId: "playback-1",
      }),
    ).resolves.toBe(svgDataUrl)

    expect(prisma.muxImageDerivative.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          purpose: "watch-hero-poster",
          muxVideoId: "mux-video-1",
          sourceUrl:
            "https://image.mux.com/playback-1/thumbnail.webp?width=1280&time=2",
          lqipUrl:
            "https://image.mux.com/playback-1/thumbnail.webp?width=32&time=2",
          blurDataUrl: svgDataUrl,
          dominantColor: expect.stringMatching(/^#[0-9a-f]{6}$/i),
        }),
      }),
    )
  })

  it("does not store corrupt image responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: new Headers({ "content-type": "image/jpeg" }),
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      })),
    )
    const prisma = makePrisma()

    await expect(
      getOrCreateWatchChapterCarouselMuxBlurDataUrl({
        prisma,
        muxVideoId: "mux-video-1",
        playbackId: "playback-1",
      }),
    ).resolves.toBeNull()

    expect(prisma.muxImageDerivative.upsert).not.toHaveBeenCalled()
  })
})

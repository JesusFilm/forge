import { afterEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"

import {
  buildWatchChapterCarouselMuxLqipUrl,
  buildWatchChapterCarouselMuxThumbnailUrl,
  buildWatchHeroPosterMuxLqipUrl,
  buildWatchHeroPosterMuxThumbnailUrl,
  getOrCreateWatchChapterCarouselMuxBlurDataUrl,
  getOrCreateWatchHeroPosterMuxBlurDataUrl,
} from "./mux-image-derivative.service"

function makePrisma({
  existingBlurDataUrl = null,
}: {
  existingBlurDataUrl?: string | null
} = {}): PrismaClient {
  const findUnique = vi.fn(async () =>
    existingBlurDataUrl ? { blurDataUrl: existingBlurDataUrl } : null,
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
    const bytes = new Uint8Array([1, 2, 3, 4])
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: new Headers({ "content-type": "image/jpeg" }),
        arrayBuffer: async () => bytes.buffer,
      })),
    )
    const prisma = makePrisma()

    await expect(
      getOrCreateWatchChapterCarouselMuxBlurDataUrl({
        prisma,
        muxVideoId: "mux-video-1",
        playbackId: "playback-1",
      }),
    ).resolves.toBe("data:image/jpeg;base64,AQIDBA==")

    expect(prisma.muxImageDerivative.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          muxVideoId: "mux-video-1",
          sourceUrl:
            "https://image.mux.com/playback-1/thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2",
          lqipUrl:
            "https://image.mux.com/playback-1/thumbnail.jpg?width=24&height=14&fit_mode=smartcrop&time=2",
          blurDataUrl: "data:image/jpeg;base64,AQIDBA==",
        }),
      }),
    )
  })

  it("stores the hero poster blur under the hero recipe", async () => {
    const bytes = new Uint8Array([5, 6, 7, 8])
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: new Headers({ "content-type": "image/webp" }),
        arrayBuffer: async () => bytes.buffer,
      })),
    )
    const prisma = makePrisma()

    await expect(
      getOrCreateWatchHeroPosterMuxBlurDataUrl({
        prisma,
        muxVideoId: "mux-video-1",
        playbackId: "playback-1",
      }),
    ).resolves.toBe("data:image/webp;base64,BQYHCA==")

    expect(prisma.muxImageDerivative.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          purpose: "watch-hero-poster",
          muxVideoId: "mux-video-1",
          sourceUrl:
            "https://image.mux.com/playback-1/thumbnail.webp?width=1280&time=2",
          lqipUrl:
            "https://image.mux.com/playback-1/thumbnail.webp?width=32&time=2",
          blurDataUrl: "data:image/webp;base64,BQYHCA==",
        }),
      }),
    )
  })
})

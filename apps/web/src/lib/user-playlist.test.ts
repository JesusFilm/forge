import { beforeEach, describe, expect, it, vi } from "vitest"

const { resolveBoundary } = vi.hoisted(() => ({
  resolveBoundary: vi.fn(),
}))

vi.mock("./user-playlist-public-boundary", () => ({
  resolvePublicUserPlaylistAtBoundary: resolveBoundary,
}))

import { loadPublicUserPlaylist } from "./user-playlist"

const capability = "c".repeat(43)

function video(id: string) {
  return {
    id,
    slug: `slug-${id}`,
    durationSeconds: 120,
    noIndex: false,
    images: [
      {
        mobileCinematicHigh: `https://images.example.test/${id}.jpg`,
        blurDataUrl: null,
      },
    ],
    locales: [{ title: `Title ${id}` }],
    preferredPlayableDub: {
      hls: "https://stream.example.test/video.m3u8",
      duration: 120,
      language: { slug: "english" },
    },
  }
}

beforeEach(() => {
  process.env.ADMIN_GRAPHQL_URL = "https://admin.jesusfilm.org/api/graphql"
  process.env.WEB_ADMIN_API_KEYS = "consumer-key"
  vi.restoreAllMocks()
  resolveBoundary.mockReset()
})

describe("loadPublicUserPlaylist", () => {
  it("hydrates 21 eligible ids in two bounded typed batches and preserves block order", async () => {
    const ids = Array.from({ length: 21 }, (_, index) => `video_${index}`)
    resolveBoundary.mockResolvedValue({
      kind: "available",
      playlist: {
        title: "Playlist",
        description: "",
        locale: "en",
        countryCode: null,
        reportIntent: "intent",
        blocks: [{ kind: "mediaCollection", title: "Videos", videoIds: ids }],
      },
    })
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          variables: Record<string, string>
        }
        const data: Record<string, unknown> = {}
        for (let index = 0; index < 20; index += 1) {
          data[`video${index}`] = video(body.variables[`id${index}`]!)
        }
        return new Response(JSON.stringify({ data }), { status: 200 })
      })

    const result = await loadPublicUserPlaylist({
      capability,
      requestHeaders: new Headers(),
    })

    expect(result.kind).toBe("available")
    if (result.kind !== "available") return
    expect(result.data.videos.map((item) => item.id)).toEqual(ids)
    expect(fetch).toHaveBeenCalledTimes(2)
    for (const [, init] of fetch.mock.calls) {
      expect(init?.cache).toBe("no-store")
      expect(String(init?.body)).not.toContain(capability)
    }
  })

  it("fails closed for the playlist predicate and omits malformed/racy media", async () => {
    resolveBoundary.mockResolvedValueOnce({ kind: "unavailable" })
    await expect(
      loadPublicUserPlaylist({
        capability,
        requestHeaders: new Headers(),
      }),
    ).resolves.toEqual({ kind: "unavailable" })

    resolveBoundary.mockResolvedValueOnce({
      kind: "available",
      playlist: {
        title: "Playlist",
        description: "",
        locale: "en",
        countryCode: null,
        reportIntent: "intent",
        blocks: [
          {
            kind: "videoCarousel",
            title: "Videos",
            videoIds: ["video_1"],
          },
        ],
      },
    })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            video0: { ...video("video_1"), noIndex: true },
          },
        }),
        { status: 200 },
      ),
    )
    const result = await loadPublicUserPlaylist({
      capability,
      requestHeaders: new Headers(),
    })
    expect(result.kind).toBe("available")
    if (result.kind === "available") expect(result.data.videos).toEqual([])
  })
})

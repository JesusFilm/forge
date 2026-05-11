import { print } from "graphql"
import { afterEach, describe, expect, it, vi } from "vitest"

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}))

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}))

vi.mock("@/lib/client", () => ({
  default: {
    query: queryMock,
  },
}))

describe("getDemoPlayableVideo", () => {
  afterEach(() => {
    queryMock.mockReset()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it("loads a playable video through admin videoBySlug", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        videoBySlug: {
          id: "clv-video-1",
          slug: "forgiveness",
          locales: [
            {
              title: "Forgiveness",
              description: "A short description",
            },
          ],
          images: [
            {
              url: "https://cdn.example/image.jpg",
              mobileCinematicHigh: "https://cdn.example/mobile.jpg",
            },
          ],
          primaryLanguage: {
            coreId: "529",
          },
          dubs: [
            {
              id: "dub-es",
              hls: "https://cdn.example/es.m3u8",
              published: true,
              language: {
                coreId: "21028",
              },
            },
            {
              id: "dub-en",
              hls: "https://cdn.example/en.m3u8",
              published: true,
              language: {
                coreId: "529",
              },
            },
          ],
        },
      },
    })

    const { getDemoPlayableVideo } = await import("./demo-search")

    const result = await getDemoPlayableVideo("forgiveness", "en")
    const query = queryMock.mock.calls[0][0].query

    expect(print(query)).toContain("videoBySlug(slug: $slug, locale: $locale)")
    expect(print(query)).toContain("dubs")
    expect(queryMock.mock.calls[0][0].variables).toEqual({
      slug: "forgiveness",
      locale: "en",
    })
    expect(result).toEqual({
      title: "Forgiveness",
      description: "A short description",
      streamingUrl: "https://cdn.example/en.m3u8",
      posterUrl: "https://cdn.example/mobile.jpg",
      imageUrl: "https://cdn.example/mobile.jpg",
    })
  })

  it("returns null when admin has no matching video", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        videoBySlug: null,
      },
    })

    const { getDemoPlayableVideo } = await import("./demo-search")

    await expect(getDemoPlayableVideo("missing", "en")).resolves.toBeNull()
  })
})

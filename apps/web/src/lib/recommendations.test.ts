import { print } from "graphql"
import { afterEach, describe, expect, it, vi } from "vitest"

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}))

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}))

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react")

  return {
    ...actual,
    cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  }
})

vi.mock("@/lib/client", () => ({
  default: {
    query: queryMock,
  },
}))

describe("recommendations data helpers", () => {
  afterEach(() => {
    queryMock.mockReset()
    vi.resetModules()
  })

  it("loads scene recommendations through adminGraphql with string video ids", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        sceneRecommendations: [
          {
            videoId: "clv-video-1",
            videoSlug: "forgiveness",
            videoTitle: "Forgiveness",
            imageUrl: null,
            sceneIndex: 4,
            description: "A forgiving scene",
            startSeconds: 30,
            endSeconds: null,
            similarity: 0.88,
            themes: ["forgiveness"],
            demographics: [],
            spiritualContext: ["grace"],
            playbackId: "mux-1",
          },
        ],
      },
    })

    const { getSceneRecommendations } = await import("./recommendations")

    const result = await getSceneRecommendations("forgiveness", "en", 10)
    const query = queryMock.mock.calls[0][0].query

    expect(print(query)).toContain("sceneRecommendations")
    expect(queryMock.mock.calls[0][0].variables).toEqual({
      slug: "forgiveness",
      locale: "en",
      limit: 10,
    })
    expect(result).toEqual([
      expect.objectContaining({
        videoId: "clv-video-1",
        videoSlug: "forgiveness",
      }),
    ])
  })

  it("returns an empty recommendation set when admin has no matching video", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        sceneRecommendations: [],
      },
    })

    const { getSceneRecommendations } = await import("./recommendations")

    await expect(getSceneRecommendations("unknown", "en", 10)).resolves.toEqual(
      [],
    )
  })

  it("maps admin videoBySlug locale data to the existing demo page shape", async () => {
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
              thumbnail: "https://cdn.example/thumb.jpg",
              mobileCinematicHigh: "https://cdn.example/mobile.jpg",
            },
          ],
        },
      },
    })

    const { getVideoBySlug } = await import("./recommendations")

    const result = await getVideoBySlug("forgiveness", "en")
    const query = queryMock.mock.calls[0][0].query

    expect(print(query)).toContain("videoBySlug(slug: $slug, locale: $locale)")
    expect(result).toEqual({
      documentId: "clv-video-1",
      slug: "forgiveness",
      title: "Forgiveness",
      description: "A short description",
      images: [
        {
          url: "https://cdn.example/image.jpg",
          thumbnail: "https://cdn.example/thumb.jpg",
          mobileCinematicHigh: "https://cdn.example/mobile.jpg",
        },
      ],
    })
  })
})

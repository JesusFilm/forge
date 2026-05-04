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

describe("resolveWatchPage", () => {
  afterEach(() => {
    queryMock.mockReset()
    vi.resetModules()
  })

  it("prefers an explicit experience when the slug matches one", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        experiences: [
          {
            documentId: "exp-1",
            slug: "christmas",
            isTemplate: false,
            title: "Christmas",
          },
        ],
      },
    })

    const { resolveWatchPage } = await import("./content")

    const result = await resolveWatchPage("en", "christmas")

    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      kind: "experience",
      experience: {
        slug: "christmas",
        isTemplate: false,
      },
    })
  })

  it("falls back to the default template for plain video slugs", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          experiences: [],
        },
      })
      .mockResolvedValueOnce({
        data: {
          videos: [
            {
              documentId: "video-1",
              slug: "jesus",
              title: "Jesus",
              snippet: "The story of Jesus",
              description: "A full description",
              imageAlt: "Jesus still",
              noIndex: false,
              images: [{ url: "https://cdn.example/jesus.jpg" }],
              primaryLanguage: { coreId: "529" },
              variants: [
                {
                  documentId: "variant-1",
                  hls: "https://cdn.example/jesus.m3u8",
                  published: true,
                  language: { coreId: "529" },
                },
              ],
              children: [
                {
                  documentId: "child-1",
                  slug: "the-beginning",
                  title: "The Beginning",
                  label: "segment",
                  images: [{ url: "https://cdn.example/child.jpg" }],
                },
                {
                  documentId: "video-1",
                  slug: "jesus",
                  title: "Jesus",
                  label: "self",
                  images: [{ url: "https://cdn.example/self.jpg" }],
                },
              ],
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          watchSetting: {
            documentId: "watch-settings-1",
            defaultTemplateExperience: {
              documentId: "exp-template-1",
              slug: "single-video",
              isTemplate: true,
              title: "Single Video Template",
            },
          },
        },
      })

    const { resolveWatchPage } = await import("./content")

    const result = await resolveWatchPage("en", "jesus")

    expect(print(queryMock.mock.calls[1][0].query)).toMatch(
      /children\(pagination:\s*\{limit:\s*24\}\)/,
    )
    // GET_ROUTE_VIDEO must paginate variants with `limit: -1` for the same
    // reason WatchVideoFragment does (see watch-video.test.ts): the default
    // 10-row return would silently drop the playable variant for any video
    // whose first 10 variants don't include the primary language, sending
    // the watch page to the wrong locale.
    expect(print(queryMock.mock.calls[1][0].query)).toMatch(
      /variants\(pagination:\s*\{\s*limit:\s*-1\s*\}\)/,
    )

    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      kind: "video-template",
      template: {
        slug: "single-video",
        isTemplate: true,
      },
      routeVideo: {
        slug: "jesus",
        title: "Jesus",
        streamingUrl: "https://cdn.example/jesus.m3u8",
        relatedItems: [
          {
            title: "The Beginning",
            label: "segment",
            videoSlug: "the-beginning",
          },
        ],
      },
    })
  })

  it("returns a configuration error when the default template is not marked as template", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          experiences: [],
        },
      })
      .mockResolvedValueOnce({
        data: {
          videos: [
            {
              documentId: "video-1",
              slug: "jesus",
              title: "Jesus",
              snippet: null,
              description: null,
              imageAlt: null,
              noIndex: false,
              images: [],
              primaryLanguage: { coreId: "529" },
              variants: [
                {
                  documentId: "variant-1",
                  hls: "https://cdn.example/jesus.m3u8",
                  published: true,
                  language: { coreId: "529" },
                },
              ],
              children: [],
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          watchSetting: {
            documentId: "watch-settings-1",
            defaultTemplateExperience: {
              documentId: "exp-template-1",
              slug: "single-video",
              isTemplate: false,
            },
          },
        },
      })

    const { resolveWatchPage } = await import("./content")

    const result = await resolveWatchPage("en", "jesus")

    expect(result.data).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
    expect(result.error?.message).toBe(
      "Default template experience must be marked as template.",
    )
  })
})

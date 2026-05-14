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

  it("returns the homepage Experience from watchSetting", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        watchSetting: {
          documentId: "watch-settings-1",
          homepageExperience: {
            documentId: "exp-home-1",
            slug: "home",
            title: "Home",
            isTemplate: false,
          },
          defaultTemplateExperience: null,
        },
      },
    })

    const { resolveWatchPage } = await import("./content")

    const result = await resolveWatchPage("en")

    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      kind: "experience",
      experience: {
        slug: "home",
      },
    })
  })

  it("returns a missing-experience error when watchSetting has no homepageExperience", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        watchSetting: {
          documentId: "watch-settings-1",
          homepageExperience: null,
          defaultTemplateExperience: null,
        },
      },
    })

    const { resolveWatchPage } = await import("./content")

    const result = await resolveWatchPage("en")

    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(result.data).toBeNull()
    expect(result.error?.message).toBe("No experience found")
  })

  it("prefers an explicit experience when the slug doesn't match the template slug", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          watchSetting: {
            documentId: "watch-settings-1",
            homepageExperience: null,
            defaultTemplateExperience: {
              documentId: "exp-template-1",
              slug: "single-video",
              title: "Single Video Template",
              isTemplate: true,
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          experiences: [
            {
              documentId: "exp-1",
              slug: "christmas",
              title: "Christmas",
              isTemplate: false,
            },
          ],
        },
      })

    const { resolveWatchPage } = await import("./content")

    const result = await resolveWatchPage("en", "christmas")

    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      kind: "experience",
      experience: {
        slug: "christmas",
      },
    })
  })

  it("falls back to the default template for plain video slugs", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          watchSetting: {
            documentId: "watch-settings-1",
            homepageExperience: null,
            defaultTemplateExperience: {
              documentId: "exp-template-1",
              slug: "single-video",
              title: "Single Video Template",
              isTemplate: true,
            },
          },
        },
      })
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

    const { resolveWatchPage } = await import("./content")

    const result = await resolveWatchPage("en", "jesus")

    expect(print(queryMock.mock.calls[2][0].query)).toMatch(
      /children\(pagination:\s*\{limit:\s*24\}\)/,
    )
    // GET_ROUTE_VIDEO must paginate variants with `limit: -1` for the same
    // reason WatchVideoFragment does (see watch-video.test.ts): the default
    // 10-row return would silently drop the playable variant for any video
    // whose first 10 variants don't include the primary language, sending
    // the watch page to the wrong locale.
    expect(print(queryMock.mock.calls[2][0].query)).toMatch(
      /variants\(pagination:\s*\{\s*limit:\s*-1\s*\}\)/,
    )

    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      kind: "video-template",
      template: {
        slug: "single-video",
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

  it("returns null/error when the video lookup succeeds but watchSetting has no defaultTemplateExperience", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          watchSetting: {
            documentId: "watch-settings-1",
            homepageExperience: null,
            // No template — even when the video exists, the route has nothing
            // to render against.
            defaultTemplateExperience: null,
          },
        },
      })
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

    const { resolveWatchPage } = await import("./content")

    const result = await resolveWatchPage("en", "jesus")

    expect(result.data).toBeNull()
    expect(result.error?.message).toBe("No experience found")
  })

  it("returns null/error when the video exists but has no playable variant", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          watchSetting: {
            documentId: "watch-settings-1",
            homepageExperience: null,
            defaultTemplateExperience: {
              documentId: "exp-template-1",
              slug: "single-video",
              title: "Single Video Template",
              isTemplate: true,
            },
          },
        },
      })
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
              // Empty variants — selectPlayableVariant returns null, so
              // normalizeRouteVideo returns null and the route bails.
              variants: [],
              children: [],
            },
          ],
        },
      })

    const { resolveWatchPage } = await import("./content")

    const result = await resolveWatchPage("en", "jesus")

    expect(result.data).toBeNull()
    expect(result.error?.message).toBe("No experience found")
  })

  it("treats the template Experience's slug as the video-template route (skips Experience lookup)", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          watchSetting: {
            documentId: "watch-settings-1",
            homepageExperience: null,
            defaultTemplateExperience: {
              documentId: "exp-template-1",
              slug: "single-video",
              title: "Single Video Template",
              isTemplate: true,
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          videos: [
            {
              documentId: "video-1",
              slug: "single-video",
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

    const { resolveWatchPage } = await import("./content")

    const result = await resolveWatchPage("en", "single-video")

    // Only watchSetting + video — no Experience lookup, because the slug
    // matches the template's slug.
    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      kind: "video-template",
      template: {
        slug: "single-video",
      },
      routeVideo: {
        slug: "single-video",
      },
    })
  })
})

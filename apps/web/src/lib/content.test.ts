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
        experienceBySlug: {
          id: "exp-1",
          slug: "christmas",
          title: "Christmas",
          blocks: [],
          referencedVideos: [],
        },
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
          experienceBySlug: null,
        },
      })
      .mockResolvedValueOnce({
        data: {
          videoBySlug: {
            documentId: "video-1",
            slug: "jesus",
            noIndex: false,
            locales: [
              {
                locale: "en",
                title: "Jesus",
                snippet: "The story of Jesus",
                description: "A full description",
                imageAlt: "Jesus still",
              },
            ],
            images: [{ url: "https://cdn.example/jesus.jpg" }],
            primaryLanguage: { coreId: "529", name: "English" },
            variants: [
              {
                documentId: "variant-1",
                hls: "https://cdn.example/jesus.m3u8",
                published: true,
                language: { coreId: "529", name: "English" },
              },
            ],
            children: [
              {
                documentId: "child-1",
                slug: "the-beginning",
                label: "segment",
                locales: [{ locale: "en", title: "The Beginning" }],
                images: [{ url: "https://cdn.example/child.jpg" }],
              },
              {
                documentId: "video-1",
                slug: "jesus",
                label: "self",
                locales: [{ locale: "en", title: "Jesus" }],
                images: [{ url: "https://cdn.example/self.jpg" }],
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          homepageExperienceLocale: null,
          defaultTemplateExperienceLocale: {
            id: "exp-template-1",
            slug: "single-video",
            title: "Single Video Template",
            blocks: [],
            referencedVideos: [],
          },
        },
      })

    const { resolveWatchPage } = await import("./content")

    const result = await resolveWatchPage("en", "jesus")

    expect(print(queryMock.mock.calls[1][0].query)).toMatch(/videoBySlug/)
    expect(print(queryMock.mock.calls[1][0].query)).toMatch(/variants: dubs/)

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

  it("hydrates referenced video streams for explicit experiences", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        experienceBySlug: {
          id: "exp-1",
          slug: "forgiveness",
          title: "Forgiveness",
          blocks: [
            {
              t: "video",
              videoId: "video-1",
            },
          ],
          referencedVideos: [
            {
              documentId: "video-1",
              slug: "jesus",
              noIndex: false,
              locales: [{ locale: "en", title: "Jesus" }],
              images: [],
              variants: [
                {
                  documentId: "variant-1",
                  published: true,
                  hls: "https://cdn.example/jesus.m3u8",
                  language: { coreId: "529" },
                },
              ],
            },
          ],
        },
      },
    })

    const { resolveWatchPage } = await import("./content")

    const result = await resolveWatchPage("en", "forgiveness")

    expect(result.error).toBeNull()
    expect(result.data?.kind).toBe("experience")
    if (result.data?.kind !== "experience") return
    expect(result.data.experience.videoMap.get("video-1")?.streamingUrl).toBe(
      "https://cdn.example/jesus.m3u8",
    )
  })

  it("returns a missing error when the default template query returns null", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          experienceBySlug: null,
        },
      })
      .mockResolvedValueOnce({
        data: {
          videoBySlug: {
            documentId: "video-1",
            slug: "jesus",
            noIndex: false,
            locales: [{ locale: "en", title: "Jesus" }],
            images: [],
            primaryLanguage: { coreId: "529", name: "English" },
            variants: [
              {
                documentId: "variant-1",
                hls: "https://cdn.example/jesus.m3u8",
                published: true,
                language: { coreId: "529", name: "English" },
              },
            ],
            children: [],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          homepageExperienceLocale: null,
          defaultTemplateExperienceLocale: null,
        },
      })

    const { resolveWatchPage } = await import("./content")

    const result = await resolveWatchPage("en", "jesus")

    expect(result.data).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
    expect(result.error?.message).toBe("No experience found")
  })
})

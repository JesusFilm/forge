import { afterEach, describe, expect, it, vi } from "vitest"

const { resolveWatchPageMock } = vi.hoisted(() => ({
  resolveWatchPageMock: vi.fn(),
}))

vi.mock("@/lib/content", () => ({
  resolveWatchPage: resolveWatchPageMock,
  experienceToMetadata: vi.fn(),
}))

describe("getWatchPageMetadata", () => {
  afterEach(() => {
    resolveWatchPageMock.mockReset()
    vi.resetModules()
  })

  it("uses route video metadata for template-backed watch pages", async () => {
    resolveWatchPageMock.mockResolvedValue({
      data: {
        kind: "video-template",
        template: {
          documentId: "exp-template-1",
          slug: "single-video",
        },
        routeVideo: {
          documentId: "video-1",
          slug: "jesus",
          title: "Jesus",
          snippet: "The story of Jesus",
          description: "Longer description",
          noIndex: true,
          imageUrl: "https://cdn.example/jesus.jpg",
          imageAlt: "Jesus still",
          streamingUrl: "https://cdn.example/jesus.m3u8",
          relatedItems: [],
        },
      },
      error: null,
    })

    const { getWatchPageMetadata } = await import("./experience-metadata")

    const metadata = await getWatchPageMetadata("en", {
      slug: "jesus",
      pathPrefix: "watch",
    })

    // Title always appends the brand suffix on the video-template branch
    // (previously the suffix only fired when routeVideo.title was empty).
    expect(metadata.title).toBe("Jesus | Jesus Film Project")
    // Description prefers the longer `description` field over the punchier
    // `snippet` for SEO (Google likes 120–160 chars). Snippet is the fallback.
    expect(metadata.description).toBe("Longer description")
    expect(metadata.alternates?.canonical).toBe(
      "https://www.jesusfilm.org/watch/jesus",
    )
    expect(metadata.openGraph).toMatchObject({
      title: "Jesus | Jesus Film Project",
      description: "Longer description",
      locale: "en_US",
      images: [
        {
          url: "https://cdn.example/jesus.jpg",
          alt: "Jesus still",
        },
      ],
    })
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })

  it("falls back to snippet when description is null", async () => {
    resolveWatchPageMock.mockResolvedValue({
      data: {
        kind: "video-template",
        template: { documentId: "exp-template-2", slug: "snippet-only" },
        routeVideo: {
          documentId: "video-2",
          slug: "snippet-only",
          title: "Snippet Only",
          snippet: "Just a snippet",
          description: null,
          noIndex: false,
          imageUrl: null,
          imageAlt: null,
          streamingUrl: null,
          relatedItems: [],
        },
      },
      error: null,
    })

    const { getWatchPageMetadata } = await import("./experience-metadata")
    const metadata = await getWatchPageMetadata("en", {
      slug: "snippet-only",
      pathPrefix: "watch",
    })

    expect(metadata.description).toBe("Just a snippet")
    // robots default is explicit index/follow when noIndex is false (new
    // behaviour from this diff — was previously absent when noIndex=false).
    expect(metadata.robots).toEqual({ index: true, follow: true })
  })
})

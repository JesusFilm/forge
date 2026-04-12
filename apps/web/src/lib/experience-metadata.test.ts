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
          isTemplate: true,
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

    expect(metadata.title).toBe("Jesus")
    expect(metadata.description).toBe("The story of Jesus")
    expect(metadata.alternates?.canonical).toBe(
      "https://www.jesusfilm.org/watch/jesus",
    )
    expect(metadata.openGraph).toMatchObject({
      title: "Jesus",
      description: "The story of Jesus",
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
})

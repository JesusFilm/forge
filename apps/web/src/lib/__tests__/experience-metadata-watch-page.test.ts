import { describe, expect, it, vi } from "vitest"

const { experienceToMetadataMock, resolveWatchPageMock } = vi.hoisted(() => ({
  experienceToMetadataMock: vi.fn<(...args: unknown[]) => unknown>(() => null),
  resolveWatchPageMock: vi.fn(),
}))

vi.mock("@/lib/content", () => ({
  experienceToMetadata: experienceToMetadataMock,
  resolveWatchPage: resolveWatchPageMock,
}))

import { getWatchPageMetadata } from "@/lib/experience-metadata"

describe("getWatchPageMetadata", () => {
  it("brands the resolved watch homepage title", async () => {
    const experience = {
      documentId: "exp-watch-home",
      slug: "watch-home",
      title: "Watch",
    }
    resolveWatchPageMock.mockResolvedValueOnce({
      data: {
        kind: "experience",
        experience,
      },
      error: null,
    })
    experienceToMetadataMock.mockReturnValueOnce({
      title: "Watch",
      description: "Watch films and series.",
      ogTitle: "Watch",
      ogDescription: "Watch films and series.",
      pathSegment: null,
      ogImage: null,
    })

    const meta = await getWatchPageMetadata("en")

    expect(meta.title).toBe("Watch | Jesus Film Project")
    expect(meta.openGraph?.title).toBe("Watch | Jesus Film Project")
  })

  it("uses the public www host for the watch home canonical and OG URL", async () => {
    resolveWatchPageMock.mockResolvedValueOnce({ data: null, error: null })

    const meta = await getWatchPageMetadata("en")

    expect(meta.alternates?.canonical).toBe("https://www.jesusfilm.org/watch")
    expect(meta.openGraph?.url).toBe("https://www.jesusfilm.org/watch")
  })

  it("uses the public www host for inner watch page canonical and OG URL", async () => {
    resolveWatchPageMock.mockResolvedValueOnce({ data: null, error: null })

    const meta = await getWatchPageMetadata("en", {
      slug: "jesus",
      pathLocale: "english",
    })

    expect(meta.alternates?.canonical).toBe(
      "https://www.jesusfilm.org/watch/jesus.html",
    )
    expect(meta.openGraph?.url).toBe(
      "https://www.jesusfilm.org/watch/jesus.html",
    )
  })
})

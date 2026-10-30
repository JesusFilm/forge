import { describe, expect, it, vi } from "vitest"

const { experienceToMetadataMock, resolveWatchPageMock } = vi.hoisted(() => ({
  experienceToMetadataMock: vi.fn<(...args: unknown[]) => unknown>(() => null),
  resolveWatchPageMock: vi.fn(),
}))

vi.mock("@/lib/content", () => ({
  experienceToMetadata: experienceToMetadataMock,
  resolveWatchPage: resolveWatchPageMock,
}))

import {
  getWatchPageMetadata,
  getWatchRouteFallbackMetadata,
} from "@/lib/experience-metadata"

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
    expect(meta.openGraph?.images).toContainEqual(
      expect.objectContaining({
        url: "https://www.jesusfilm.org/watch/images/watch-social-card.jpg",
        width: 1200,
        height: 630,
        alt: "Jesus teaches a group beside the Sea of Galilee",
      }),
    )
  })

  it("uses the first-party social card when route metadata falls back after an error", () => {
    const meta = getWatchRouteFallbackMetadata("en", { slug: "jesus" })

    expect(meta.openGraph?.images).toContainEqual(
      expect.objectContaining({
        url: "https://www.jesusfilm.org/watch/images/watch-social-card.jpg",
        width: 1200,
        height: 630,
        alt: "Jesus teaches a group beside the Sea of Galilee",
      }),
    )
  })

  it.each([
    {
      locale: "en",
      options: undefined,
      canonical: "https://www.jesusfilm.org/watch",
      ogLocale: "en_US",
    },
    {
      locale: "es",
      options: { pathLocale: "spanish-castilian" },
      canonical: "https://www.jesusfilm.org/watch/spanish-castilian.html",
      ogLocale: "es_ES",
    },
    {
      locale: "pt",
      options: { slug: "jesus", pathLocale: "portuguese-brazil" },
      canonical:
        "https://www.jesusfilm.org/watch/jesus.html/portuguese-brazil.html",
      ogLocale: "pt_BR",
    },
  ])(
    "keeps both sharing channels and canonical identity on the $locale fallback",
    ({ locale, options, canonical, ogLocale }) => {
      const meta = getWatchRouteFallbackMetadata(locale, options)
      const image = {
        url: "https://www.jesusfilm.org/watch/images/watch-social-card.jpg",
        alt: "Jesus teaches a group beside the Sea of Galilee",
      }

      expect(meta.openGraph).toMatchObject({
        url: canonical,
        locale: ogLocale,
        images: [{ ...image, width: 1200, height: 630, type: "image/jpeg" }],
      })
      expect(meta.twitter).toMatchObject({
        card: "summary_large_image",
        images: [image],
      })
      expect(meta.alternates).toEqual({ canonical })
      expect(meta.robots).toEqual({ index: true, follow: true })
    },
  )

  it("uses the same first-party fallback when the resolver returns a metadata error", async () => {
    resolveWatchPageMock.mockResolvedValueOnce({
      data: null,
      error: new Error("fixture resolver failure"),
    })
    const meta = await getWatchPageMetadata("es", {
      pathLocale: "spanish-castilian",
    })
    expect(meta).toEqual(
      getWatchRouteFallbackMetadata("es", { pathLocale: "spanish-castilian" }),
    )
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

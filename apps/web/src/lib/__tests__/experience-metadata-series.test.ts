import { describe, expect, it } from "vitest"

import { generateSeriesMetadata } from "@/lib/experience-metadata"
import type { ResolvedSeriesBySlug } from "@/lib/content"

type Series = ResolvedSeriesBySlug["video"]

function makeSeries(overrides: Partial<Series> = {}): Series {
  return {
    documentId: "series-1",
    slug: "storyclubs",
    title: "StoryClubs",
    snippet: null,
    description: "A series about Bible stories for kids.",
    noIndex: false,
    label: "collection",
    imageAlt: null,
    images: [
      {
        url: "https://cdn.example/storyclubs.jpg",
        thumbnail: null,
        mobileCinematicHigh: "https://cdn.example/storyclubs.high.jpg",
        mobileCinematicLow: null,
      },
    ],
    primaryLanguage: { coreId: "529", bcp47: "en" },
    parents: [],
    children: [],
    variants: [],
    studyQuestions: [],
    bibleCitations: [],
    ...overrides,
  } as Series
}

describe("generateSeriesMetadata", () => {
  it("populates title with the SITE TITLE_SUFFIX appended", () => {
    const meta = generateSeriesMetadata("en", {
      series: makeSeries(),
      pathLocale: "en",
    })
    expect(meta.title).toBe("StoryClubs | Jesus Film Project")
  })

  it("populates description from series.description", () => {
    const meta = generateSeriesMetadata("en", {
      series: makeSeries(),
      pathLocale: "en",
    })
    expect(meta.description).toBe("A series about Bible stories for kids.")
  })

  it("falls back to series.snippet when description is null", () => {
    const meta = generateSeriesMetadata("en", {
      series: makeSeries({ description: null, snippet: "Snippet text" }),
      pathLocale: "en",
    })
    expect(meta.description).toBe("Snippet text")
  })

  it("returns undefined description when both description and snippet are null", () => {
    const meta = generateSeriesMetadata("en", {
      series: makeSeries({ description: null, snippet: null }),
      pathLocale: "en",
    })
    expect(meta.description).toBeUndefined()
  })

  it("constructs the canonical URL in the .html shape via the route builder", () => {
    const meta = generateSeriesMetadata("en", {
      series: makeSeries(),
      pathLocale: "english",
    })
    expect(meta.alternates?.canonical).toBe(
      "https://www.jesusfilm.org/watch/storyclubs.html",
    )
    expect(meta.openGraph?.url).toBe(
      "https://www.jesusfilm.org/watch/storyclubs.html",
    )
  })

  it("populates openGraph.images from the series poster (mobileCinematicHigh)", () => {
    const meta = generateSeriesMetadata("en", {
      series: makeSeries(),
      pathLocale: "en",
    })
    const images = meta.openGraph?.images as Array<{ url: string }>
    expect(images?.[0]?.url).toBe("https://cdn.example/storyclubs.high.jpg")
  })

  it("falls back to the default OG image when series.images is empty", () => {
    const meta = generateSeriesMetadata("en", {
      series: makeSeries({ images: [] }),
      pathLocale: "en",
    })
    const images = meta.openGraph?.images as Array<{ url: string }>
    expect(images?.[0]?.url).toContain("unsplash.com")
  })

  it("sets robots index/follow false when series.noIndex is true", () => {
    const meta = generateSeriesMetadata("en", {
      series: makeSeries({ noIndex: true }),
      pathLocale: "en",
    })
    expect(meta.robots).toEqual({ index: false, follow: false })
  })

  it("uses 'Watch | Jesus Film Project' as the title fallback when series.title is null", () => {
    const meta = generateSeriesMetadata("en", {
      series: makeSeries({ title: null }),
      pathLocale: "en",
    })
    expect(meta.title).toBe("Watch | Jesus Film Project")
  })
})

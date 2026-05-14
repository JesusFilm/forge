/**
 * @vitest-environment jsdom
 *
 * U5 — /[slug]/[locale] route branching.
 *
 * The page is a server component returning JSX. We mock the resolvers
 * AND the leaf components, then render the returned JSX through
 * createRoot so the mocked components actually get called. Each
 * scenario exercises a single branch of the routing logic.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
  resolveWatchVideoBySlugMock,
  resolveSeriesBySlugMock,
  resolveWatchPageMock,
  seriesPageClientMock,
  watchPageClientMock,
  experienceEmptyMock,
  experienceErrorMock,
} = vi.hoisted(() => ({
  resolveWatchVideoBySlugMock: vi.fn(),
  resolveSeriesBySlugMock: vi.fn(),
  resolveWatchPageMock: vi.fn(),
  seriesPageClientMock: vi.fn(
    (_props: { series: unknown; selectedVariant: unknown; locale: string }) =>
      null,
  ),
  watchPageClientMock: vi.fn((_props: unknown) => null),
  experienceEmptyMock: vi.fn(() => null),
  experienceErrorMock: vi.fn(() => null),
}))

// Stub the admin Apollo client so the jsdom test environment doesn't trip
// t3-env's server-only guard on `WEB_ADMIN_API_KEYS` when content.ts loads.
vi.mock("@/lib/admin-client", () => ({
  default: { query: vi.fn() },
}))

vi.mock("@/lib/content", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/content")>("@/lib/content")
  return {
    ...actual,
    resolveWatchVideoBySlug: resolveWatchVideoBySlugMock,
    resolveSeriesBySlug: resolveSeriesBySlugMock,
    resolveWatchPage: resolveWatchPageMock,
  }
})

vi.mock("@/components/watch/SeriesPageClient", () => ({
  SeriesPageClient: seriesPageClientMock,
}))

vi.mock("@/components/watch/WatchPageClient", () => ({
  WatchPageClient: watchPageClientMock,
}))

vi.mock("@/components/ExperienceEmpty", () => ({
  ExperienceEmpty: experienceEmptyMock,
}))

vi.mock("@/components/ExperienceError", () => ({
  ExperienceError: experienceErrorMock,
}))

vi.mock("@/components/sections", () => ({
  SectionRenderer: vi.fn(() => null),
}))

import SlugLocalePage from "@/app/[slug]/[locale]/page"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  resolveWatchVideoBySlugMock.mockReset()
  resolveSeriesBySlugMock.mockReset()
  resolveWatchPageMock.mockReset()
  seriesPageClientMock.mockClear()
  watchPageClientMock.mockClear()
  experienceEmptyMock.mockClear()
  experienceErrorMock.mockClear()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

function makeWatchVideoResult(label: string) {
  return {
    video: {
      documentId: "v1",
      slug: "storyclubs",
      title: "StoryClubs",
      label,
      images: [],
      children: [],
      variants: [],
    },
    canonicalParent: null,
    selectedVariant: {
      documentId: "var1",
      hls: "https://cdn.example/storyclubs.m3u8",
      muxVideo: { playbackId: "pb1" },
      language: { slug: "english", name: "English" },
      published: true,
      duration: 30,
      downloads: [],
    },
  }
}

function makeSeriesResult() {
  return {
    video: {
      documentId: "s1",
      slug: "storyclubs",
      title: "StoryClubs",
      label: "collection",
      images: [],
      children: [
        {
          documentId: "ep1",
          slug: "ep-1",
          title: "Ep 1",
          label: "episode",
          images: [],
        },
      ],
      variants: [],
    },
    selectedVariant: null,
  }
}

async function renderPage(slug: string, locale: string) {
  const element = await SlugLocalePage({
    params: Promise.resolve({ slug, locale }),
  })
  act(() => {
    root.render(element)
  })
}

describe("SlugLocalePage routing — series branch", () => {
  it("renders SeriesPageClient when video resolver returns a COLLECTION-labeled record", async () => {
    resolveWatchVideoBySlugMock.mockResolvedValue(
      makeWatchVideoResult("collection"),
    )
    await renderPage("storyclubs", "en")
    expect(seriesPageClientMock).toHaveBeenCalledTimes(1)
    expect(watchPageClientMock).not.toHaveBeenCalled()
    // Single round-trip: the series resolver should NOT be hit when the
    // video resolver already returned a series-shaped record.
    expect(resolveSeriesBySlugMock).not.toHaveBeenCalled()
  })

  it("renders SeriesPageClient when label is 'series' (defensive OR)", async () => {
    resolveWatchVideoBySlugMock.mockResolvedValue(
      makeWatchVideoResult("series"),
    )
    await renderPage("any-series", "en")
    expect(seriesPageClientMock).toHaveBeenCalledTimes(1)
    expect(watchPageClientMock).not.toHaveBeenCalled()
  })

  it("renders WatchPageClient when label is non-series (regression guard)", async () => {
    resolveWatchVideoBySlugMock.mockResolvedValue(
      makeWatchVideoResult("featureFilm"),
    )
    await renderPage("jesus", "en")
    expect(watchPageClientMock).toHaveBeenCalledTimes(1)
    expect(seriesPageClientMock).not.toHaveBeenCalled()
  })
})

describe("SlugLocalePage routing — series-without-trailer fallthrough", () => {
  it("falls through to resolveSeriesBySlug when video resolver returns null and renders SeriesPageClient", async () => {
    resolveWatchVideoBySlugMock.mockResolvedValue(null)
    resolveSeriesBySlugMock.mockResolvedValue(makeSeriesResult())
    await renderPage("storyclubs-no-trailer", "en")
    expect(seriesPageClientMock).toHaveBeenCalledTimes(1)
    expect(resolveSeriesBySlugMock).toHaveBeenCalledWith(
      "storyclubs-no-trailer",
      "en",
    )
    expect(watchPageClientMock).not.toHaveBeenCalled()
  })

  it("falls through to ExperienceEmpty when both resolvers return null and resolveWatchPage reports missing", async () => {
    resolveWatchVideoBySlugMock.mockResolvedValue(null)
    resolveSeriesBySlugMock.mockResolvedValue(null)
    resolveWatchPageMock.mockResolvedValue({
      data: null,
      error: { message: "No experience found" },
    })
    await renderPage("missing-slug", "en")
    expect(experienceEmptyMock).toHaveBeenCalledTimes(1)
    expect(seriesPageClientMock).not.toHaveBeenCalled()
    expect(watchPageClientMock).not.toHaveBeenCalled()
  })
})

describe("SlugLocalePage routing — passes correct props to SeriesPageClient", () => {
  it("passes selectedVariant from the video resolver in trailer-mode series rendering", async () => {
    const watchVideo = makeWatchVideoResult("collection")
    resolveWatchVideoBySlugMock.mockResolvedValue(watchVideo)
    await renderPage("storyclubs", "en")
    const args = seriesPageClientMock.mock.calls[0]?.[0]
    expect(args?.selectedVariant).toBe(watchVideo.selectedVariant)
    expect(args?.locale).toBe("en")
  })

  it("passes selectedVariant=null in static-mode (trailerless) series rendering", async () => {
    resolveWatchVideoBySlugMock.mockResolvedValue(null)
    resolveSeriesBySlugMock.mockResolvedValue(makeSeriesResult())
    await renderPage("storyclubs-no-trailer", "en")
    const args = seriesPageClientMock.mock.calls[0]?.[0]
    expect(args?.selectedVariant).toBeNull()
    expect(args?.locale).toBe("en")
  })

  it("passes the raw slug-form locale (e.g. 'spanish-castilian') in trailer-mode, NOT the bcp47-normalised value", async () => {
    // When the language switcher writes a slug-form locale, the URL
    // path is /{slug}/spanish-castilian. isLocale("spanish-castilian")
    // returns false, so the bcp47-normalised value would collapse to
    // DEFAULT_LOCALE ("en") and the combobox/globe modal would render
    // English instead of the user's actual selection. The page must
    // forward rawLocale into SeriesPageClient.
    const watchVideo = makeWatchVideoResult("collection")
    resolveWatchVideoBySlugMock.mockResolvedValue(watchVideo)
    await renderPage("storyclubs", "spanish-castilian")
    const args = seriesPageClientMock.mock.calls[0]?.[0]
    expect(args?.locale).toBe("spanish-castilian")
  })

  it("passes the raw slug-form locale in static-mode (trailerless) too", async () => {
    resolveWatchVideoBySlugMock.mockResolvedValue(null)
    resolveSeriesBySlugMock.mockResolvedValue(makeSeriesResult())
    await renderPage("storyclubs-no-trailer", "spanish-castilian")
    const args = seriesPageClientMock.mock.calls[0]?.[0]
    expect(args?.locale).toBe("spanish-castilian")
  })
})

/**
 * @vitest-environment jsdom
 *
 * Catch-all route /watch/[locale]/[htmlLang]/[...rest] — segment-count
 * dispatch for public one-, two-, and three-segment watch URL shapes after
 * the proxy prepends static locale layout params.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
  resolveWatchVideoBySlugMock,
  resolveSeriesBySlugMock,
  resolveSeriesEpisodeBySlugMock,
  resolveWatchExperiencePageMock,
  resolveWatchPageMock,
  notFoundMock,
  redirectMock,
  seriesPageClientMock,
  watchPageClientMock,
  watchQuestionPanelMock,
  experienceEmptyMock,
  experienceErrorMock,
  isWatchCtaTextCopyEnabledMock,
  isWatchYouVersionBibleQuotesEnabledMock,
  fetchYouVersionBibleQuotePassagesMock,
  isWatchQuestionPanelEnabledMock,
} = vi.hoisted(() => ({
  resolveWatchVideoBySlugMock: vi.fn(),
  resolveSeriesBySlugMock: vi.fn(),
  resolveSeriesEpisodeBySlugMock: vi.fn(),
  resolveWatchExperiencePageMock: vi.fn(),
  resolveWatchPageMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
  redirectMock: vi.fn((destination: string) => {
    throw new Error(`NEXT_REDIRECT:${destination}`)
  }),
  seriesPageClientMock: vi.fn(
    (_props: { series: unknown; selectedVariant: unknown; locale: string }) =>
      null,
  ),
  watchPageClientMock: vi.fn((_props: unknown) => null),
  watchQuestionPanelMock: vi.fn((_props: unknown) => null),
  experienceEmptyMock: vi.fn(() => null),
  experienceErrorMock: vi.fn(() => null),
  isWatchCtaTextCopyEnabledMock: vi.fn(async () => false),
  isWatchYouVersionBibleQuotesEnabledMock: vi.fn(async () => false),
  fetchYouVersionBibleQuotePassagesMock: vi.fn(),
  isWatchQuestionPanelEnabledMock: vi.fn(async () => false),
}))

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
    resolveSeriesEpisodeBySlug: resolveSeriesEpisodeBySlugMock,
    resolveWatchExperiencePage: resolveWatchExperiencePageMock,
    resolveWatchPage: resolveWatchPageMock,
  }
})

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
  redirect: redirectMock,
}))

vi.mock("@/components/watch/SeriesPageClient", () => ({
  SeriesPageClient: seriesPageClientMock,
}))

vi.mock("@/components/watch/WatchPageClient", () => ({
  WatchPageClient: watchPageClientMock,
}))

vi.mock("@/components/watch/WatchQuestionPanel", () => ({
  WatchQuestionPanel: watchQuestionPanelMock,
}))

vi.mock("@/components/ExperienceEmpty", () => ({
  ExperienceEmpty: experienceEmptyMock,
}))

vi.mock("@/components/ExperienceError", () => ({
  ExperienceError: experienceErrorMock,
}))

vi.mock("@/components/sections", () => ({
  ExperienceSectionRenderer: vi.fn(() => null),
}))

vi.mock("@/lib/feature-flags", () => ({
  isWatchCtaTextCopyEnabled: isWatchCtaTextCopyEnabledMock,
  isWatchYouVersionBibleQuotesEnabled: isWatchYouVersionBibleQuotesEnabledMock,
  isWatchQuestionPanelEnabled: isWatchQuestionPanelEnabledMock,
}))

vi.mock("@/lib/youversion-passage", () => ({
  fetchYouVersionBibleQuotePassages: fetchYouVersionBibleQuotePassagesMock,
}))

import SlugRestPage from "@/app/[locale]/[htmlLang]/[...rest]/page"
import { resolveWatchLocaleIdentity } from "@/lib/locale"
import { stripHtmlSuffix } from "@/lib/url-shape"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  resolveWatchVideoBySlugMock.mockReset()
  resolveSeriesBySlugMock.mockReset()
  resolveSeriesEpisodeBySlugMock.mockReset()
  resolveWatchExperiencePageMock.mockReset()
  resolveWatchPageMock.mockReset()
  notFoundMock.mockClear()
  redirectMock.mockClear()
  // Default: no Experience curated for the slug.
  resolveWatchPageMock.mockResolvedValue({
    data: null,
    error: new Error("No experience found"),
  })
  resolveWatchExperiencePageMock.mockResolvedValue({
    data: null,
    error: new Error("No experience found"),
  })
  seriesPageClientMock.mockClear()
  watchPageClientMock.mockClear()
  watchQuestionPanelMock.mockClear()
  experienceEmptyMock.mockClear()
  experienceErrorMock.mockClear()
  isWatchCtaTextCopyEnabledMock.mockReset()
  isWatchCtaTextCopyEnabledMock.mockResolvedValue(false)
  isWatchYouVersionBibleQuotesEnabledMock.mockReset()
  isWatchYouVersionBibleQuotesEnabledMock.mockResolvedValue(false)
  fetchYouVersionBibleQuotePassagesMock.mockReset()
  fetchYouVersionBibleQuotePassagesMock.mockResolvedValue([])
  isWatchQuestionPanelEnabledMock.mockReset()
  isWatchQuestionPanelEnabledMock.mockResolvedValue(false)
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

function makeWatchVideoResult(
  label: string,
  variantLang: { slug: string; bcp47: string; name: string } = {
    slug: "english",
    bcp47: "en",
    name: "English",
  },
) {
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
      language: variantLang,
      published: true,
      duration: 30,
      downloads: [],
    },
  }
}

function makeBibleCitations() {
  return [
    {
      bibleBook: { documentId: "bb-john", name: "John" },
      chapterEnd: null,
      chapterStart: 3,
      documentId: "bc-1",
      order: 1,
      osisId: "John.3.16",
      verseEnd: null,
      verseStart: 16,
    },
  ]
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

function makeEpisodeResult(
  variantLang: { slug: string; bcp47: string; name: string } = {
    slug: "english",
    bcp47: "en",
    name: "English",
  },
) {
  return {
    video: {
      documentId: "ep-1",
      slug: "wedding-in-cana",
      title: "Wedding in Cana",
      label: "episode",
      images: [],
      children: [],
      variants: [],
      parents: [
        {
          documentId: "series-1",
          slug: "lumo-the-gospel-of-john",
          title: "Lumo Gospel of John",
          label: "series",
          images: [],
          children: [],
        },
      ],
    },
    canonicalParent: {
      documentId: "series-1",
      slug: "lumo-the-gospel-of-john",
      title: "Lumo Gospel of John",
      label: "series",
      images: [],
      children: [],
    },
    series: {
      documentId: "series-1",
      slug: "lumo-the-gospel-of-john",
      title: "Lumo Gospel of John",
      label: "series",
      images: [],
      children: [],
    },
    selectedVariant: {
      documentId: "var-1",
      hls: "https://cdn.example/ep.m3u8",
      muxVideo: { playbackId: "pb-1" },
      language: variantLang,
      published: true,
      duration: 30,
      downloads: [],
    },
  }
}

function internalLocaleParams(rawLocale?: string) {
  return resolveWatchLocaleIdentity(
    rawLocale ? stripHtmlSuffix(rawLocale) : null,
  )
}

async function render1Seg(segment: string) {
  const stripped = stripHtmlSuffix(segment)
  const identity = internalLocaleParams(stripped)
  const element = await SlugRestPage({
    params: Promise.resolve({ ...identity, rest: [segment] }),
  })
  act(() => {
    root.render(element)
  })
}

async function render2Seg(slug: string, locale: string) {
  const identity = internalLocaleParams(locale)
  const element = await SlugRestPage({
    params: Promise.resolve({ ...identity, rest: [slug, locale] }),
  })
  act(() => {
    root.render(element)
  })
}

async function render3Seg(slug: string, episode: string, locale: string) {
  const identity = internalLocaleParams(locale)
  const element = await SlugRestPage({
    params: Promise.resolve({ ...identity, rest: [slug, episode, locale] }),
  })
  act(() => {
    root.render(element)
  })
}

describe("Catch-all routing — one-segment collection/home branch", () => {
  it("keeps best-effort collection slugs such as /easter.html out of localized-home dispatch", async () => {
    resolveWatchExperiencePageMock.mockResolvedValue({
      data: {
        kind: "experience",
        experience: {
          id: "exp-easter",
          slug: "easter",
          title: "Easter",
          blocks: [{ __typename: "TextBlock", id: "blk-1", text: "Hello" }],
        },
      },
      error: null,
    })

    await render1Seg("easter.html")

    expect(resolveWatchExperiencePageMock).toHaveBeenCalledWith("en", "easter")
    expect(resolveWatchPageMock).not.toHaveBeenCalled()
    expect(resolveWatchVideoBySlugMock).not.toHaveBeenCalled()
    expect(experienceEmptyMock).not.toHaveBeenCalled()
  })

  it("dispatches one-segment public language slugs to localized home", async () => {
    resolveWatchPageMock.mockResolvedValue({
      data: {
        kind: "experience",
        experience: {
          id: "exp-es",
          slug: "home",
          title: "Spanish Home",
          blocks: [{ __typename: "TextBlock", id: "blk-1", text: "Hola" }],
        },
      },
      error: null,
    })

    await render1Seg("spanish-castilian.html")

    expect(resolveWatchPageMock).toHaveBeenCalledWith("es")
    expect(resolveWatchVideoBySlugMock).not.toHaveBeenCalled()
  })

  it("404s one-segment non-language misses instead of rendering the empty shell", async () => {
    resolveWatchExperiencePageMock.mockResolvedValue({
      data: null,
      error: new Error("No experience found"),
    })

    await expect(render1Seg("jesus.html")).rejects.toThrow("NEXT_NOT_FOUND")

    expect(resolveWatchExperiencePageMock).not.toHaveBeenCalled()
    expect(resolveWatchPageMock).not.toHaveBeenCalled()
    expect(resolveWatchVideoBySlugMock).not.toHaveBeenCalled()
    expect(notFoundMock).toHaveBeenCalledTimes(1)
    expect(experienceEmptyMock).not.toHaveBeenCalled()
  })

  it("does not run one-segment non-language slugs through the default video template resolver", async () => {
    resolveWatchPageMock.mockResolvedValue({
      data: {
        kind: "video-template",
        template: {
          id: "exp-template-1",
          slug: "single-video",
          title: "Single Video Template",
          blocks: [{ __typename: "TextBlock", id: "blk-1", text: "Hello" }],
        },
        routeVideo: { slug: "jesus", title: "Jesus" },
      },
      error: null,
    })

    await expect(render1Seg("jesus.html")).rejects.toThrow("NEXT_NOT_FOUND")

    expect(resolveWatchExperiencePageMock).not.toHaveBeenCalled()
    expect(resolveWatchPageMock).not.toHaveBeenCalled()
    expect(notFoundMock).toHaveBeenCalledTimes(1)
    expect(experienceEmptyMock).not.toHaveBeenCalled()
  })
})

describe("Catch-all routing — series branch (2-seg)", () => {
  it("renders SeriesPageClient when video resolver returns a COLLECTION-labeled record", async () => {
    resolveWatchVideoBySlugMock.mockResolvedValue(
      makeWatchVideoResult("collection"),
    )
    await render2Seg("storyclubs", "english")
    expect(seriesPageClientMock).toHaveBeenCalledTimes(1)
    expect(watchPageClientMock).not.toHaveBeenCalled()
    expect(resolveSeriesBySlugMock).not.toHaveBeenCalled()
  })

  it("renders SeriesPageClient when label is 'series' (defensive OR)", async () => {
    resolveWatchVideoBySlugMock.mockResolvedValue(
      makeWatchVideoResult("series"),
    )
    await render2Seg("any-series", "english")
    expect(seriesPageClientMock).toHaveBeenCalledTimes(1)
    expect(watchPageClientMock).not.toHaveBeenCalled()
  })

  it("renders WatchPageClient when label is non-series (regression guard)", async () => {
    resolveWatchVideoBySlugMock.mockResolvedValue(
      makeWatchVideoResult("featureFilm"),
    )
    await render2Seg("jesus", "english")
    expect(watchPageClientMock).toHaveBeenCalledTimes(1)
    expect(watchPageClientMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        questionPanelEnabled: false,
      }),
    )
    expect(seriesPageClientMock).not.toHaveBeenCalled()
  })

  it("404s bcp47 catalog keys in public audio slots", async () => {
    resolveWatchVideoBySlugMock.mockResolvedValue(
      makeWatchVideoResult("featureFilm"),
    )
    await expect(render2Seg("jesus", "en")).rejects.toThrow("NEXT_NOT_FOUND")
    expect(resolveWatchVideoBySlugMock).not.toHaveBeenCalled()
  })

  it("404s unknown public audio slugs before content or experience lookup", async () => {
    await expect(render2Seg("easter", "non-existent")).rejects.toThrow(
      "NEXT_NOT_FOUND",
    )

    expect(resolveWatchPageMock).not.toHaveBeenCalled()
    expect(resolveWatchVideoBySlugMock).not.toHaveBeenCalled()
  })

  it("keeps the YouVersion Bible Quotes panel disabled by default", async () => {
    const watchVideoResult = makeWatchVideoResult("featureFilm")
    const bibleCitations = makeBibleCitations()
    ;(
      watchVideoResult.video as { bibleCitations?: typeof bibleCitations }
    ).bibleCitations = bibleCitations
    resolveWatchVideoBySlugMock.mockResolvedValue(watchVideoResult)

    await render2Seg("jesus.html", "english.html")

    expect(isWatchYouVersionBibleQuotesEnabledMock).toHaveBeenCalledWith({
      custom: { route: "/watch/jesus.html/english.html" },
    })
    expect(fetchYouVersionBibleQuotePassagesMock).not.toHaveBeenCalled()
    const props = watchPageClientMock.mock.calls[0]?.[0] as {
      mergedBlocks: Array<{
        kind?: string
        youVersionPassages?: Array<unknown>
      }>
    }
    expect(
      props.mergedBlocks.find((block) => block.kind === "BibleQuotes")
        ?.youVersionPassages,
    ).toEqual([])
  })

  it("passes YouVersion passages into Bible Quotes when the LaunchDarkly flag is enabled", async () => {
    isWatchYouVersionBibleQuotesEnabledMock.mockResolvedValue(true)
    fetchYouVersionBibleQuotePassagesMock.mockResolvedValue([
      {
        citationDocumentId: "bc-1",
        content: "Server passage.",
        copyright: "Copyright.",
        humanReference: "John 3:16",
        publisherUrl: null,
        reference: "JHN.3.16",
        versionAbbreviation: "BSB",
        versionId: 3034,
        versionTitle: "Berean Standard Bible",
      },
    ])
    const watchVideoResult = makeWatchVideoResult("featureFilm")
    const bibleCitations = makeBibleCitations()
    ;(
      watchVideoResult.video as { bibleCitations?: typeof bibleCitations }
    ).bibleCitations = bibleCitations
    resolveWatchVideoBySlugMock.mockResolvedValue(watchVideoResult)

    await render2Seg("jesus.html", "english.html")

    expect(isWatchYouVersionBibleQuotesEnabledMock).toHaveBeenCalledWith({
      custom: { route: "/watch/jesus.html/english.html" },
    })
    expect(fetchYouVersionBibleQuotePassagesMock).toHaveBeenCalledWith(
      bibleCitations,
    )
    const props = watchPageClientMock.mock.calls[0]?.[0] as {
      mergedBlocks: Array<{
        kind?: string
        youVersionPassages?: Array<unknown>
      }>
    }
    expect(
      props.mergedBlocks.find((block) => block.kind === "BibleQuotes")
        ?.youVersionPassages,
    ).toEqual([
      expect.objectContaining({
        content: "Server passage.",
        reference: "JHN.3.16",
      }),
    ])
  })

  it("passes the LaunchDarkly CTA copy label to WatchPageClient when enabled", async () => {
    isWatchCtaTextCopyEnabledMock.mockResolvedValue(true)
    resolveWatchVideoBySlugMock.mockResolvedValue(
      makeWatchVideoResult("featureFilm"),
    )

    await render2Seg("jesus.html", "english.html")

    expect(isWatchCtaTextCopyEnabledMock).toHaveBeenCalledWith({
      custom: { route: "/watch/jesus.html/english.html" },
    })
    expect(watchPageClientMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        downloadButtonLabel: "Save Video",
      }),
    )
  })

  it("passes the LaunchDarkly question panel flag to WatchPageClient when enabled", async () => {
    isWatchQuestionPanelEnabledMock.mockResolvedValue(true)
    resolveWatchVideoBySlugMock.mockResolvedValue(
      makeWatchVideoResult("featureFilm"),
    )

    await render2Seg("jesus.html", "english.html")

    expect(isWatchQuestionPanelEnabledMock).toHaveBeenCalledWith({
      custom: { route: "/watch/jesus.html/english.html" },
    })
    expect(watchPageClientMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        questionPanelEnabled: true,
      }),
    )
  })
})

describe("Catch-all routing — Experience precedence (2-seg)", () => {
  it("renders Experience and skips video resolver when Experience exists for the slug", async () => {
    resolveWatchPageMock.mockResolvedValue({
      data: {
        kind: "experience",
        experience: {
          id: "exp-1",
          slug: "easter",
          title: "Easter",
          blocks: [{ __typename: "TextBlock", id: "blk-1", text: "Hello" }],
        },
      },
      error: null,
    })
    resolveWatchVideoBySlugMock.mockResolvedValue(
      makeWatchVideoResult("collection"),
    )
    await render2Seg("easter", "english")
    expect(seriesPageClientMock).not.toHaveBeenCalled()
    expect(watchPageClientMock).not.toHaveBeenCalled()
    expect(watchQuestionPanelMock).not.toHaveBeenCalled()
    expect(resolveWatchVideoBySlugMock).not.toHaveBeenCalled()
  })

  it("renders the gated question panel for curated watch experiences when enabled", async () => {
    isWatchQuestionPanelEnabledMock.mockResolvedValue(true)
    resolveWatchPageMock.mockResolvedValue({
      data: {
        kind: "experience",
        experience: {
          id: "exp-1",
          slug: "easter",
          title: "Easter",
          blocks: [{ __typename: "TextBlock", id: "blk-1", text: "Hello" }],
        },
      },
      error: null,
    })

    await render2Seg("easter.html", "english.html")

    expect(isWatchQuestionPanelEnabledMock).toHaveBeenCalledWith({
      custom: { route: "/watch/easter.html/english.html" },
    })
    expect(watchQuestionPanelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
      }),
      undefined,
    )
    expect(watchPageClientMock).not.toHaveBeenCalled()
    expect(resolveWatchVideoBySlugMock).not.toHaveBeenCalled()
  })

  it("falls through to ExperienceEmpty when Experience has no blocks", async () => {
    resolveWatchPageMock.mockResolvedValue({
      data: {
        kind: "experience",
        experience: { id: "exp-1", slug: "x", title: "X", blocks: [] },
      },
      error: null,
    })
    await render2Seg("x", "english")
    expect(experienceEmptyMock).toHaveBeenCalledTimes(1)
    expect(resolveWatchVideoBySlugMock).not.toHaveBeenCalled()
  })
})

describe("Catch-all routing — series-without-trailer fallthrough (2-seg)", () => {
  it("falls through to resolveSeriesBySlug when video resolver returns null", async () => {
    resolveWatchVideoBySlugMock.mockResolvedValue(null)
    resolveSeriesBySlugMock.mockResolvedValue(makeSeriesResult())
    await render2Seg("storyclubs-no-trailer", "english")
    expect(seriesPageClientMock).toHaveBeenCalledTimes(1)
    expect(resolveSeriesBySlugMock).toHaveBeenCalledWith(
      "storyclubs-no-trailer",
      "en",
    )
    expect(watchPageClientMock).not.toHaveBeenCalled()
  })

  it("404s when both resolvers return null and watchPage reports missing", async () => {
    resolveWatchVideoBySlugMock.mockResolvedValue(null)
    resolveSeriesBySlugMock.mockResolvedValue(null)
    resolveWatchPageMock.mockResolvedValue({
      data: null,
      error: { message: "No experience found" },
    })
    await expect(render2Seg("missing-slug", "english")).rejects.toThrow(
      "NEXT_NOT_FOUND",
    )
    expect(notFoundMock).toHaveBeenCalledTimes(1)
    expect(experienceEmptyMock).not.toHaveBeenCalled()
    expect(seriesPageClientMock).not.toHaveBeenCalled()
    expect(watchPageClientMock).not.toHaveBeenCalled()
  })
})

describe("Catch-all routing — props passed to SeriesPageClient (2-seg)", () => {
  it("passes selectedVariant in trailer-mode series rendering", async () => {
    const watchVideo = makeWatchVideoResult("collection")
    resolveWatchVideoBySlugMock.mockResolvedValue(watchVideo)
    await render2Seg("storyclubs", "english")
    const args = seriesPageClientMock.mock.calls[0]?.[0]
    expect(args?.selectedVariant).toBe(watchVideo.selectedVariant)
    expect(args?.locale).toBe("english")
  })

  it("passes selectedVariant=null in static-mode (trailerless) series rendering", async () => {
    resolveWatchVideoBySlugMock.mockResolvedValue(null)
    resolveSeriesBySlugMock.mockResolvedValue(makeSeriesResult())
    await render2Seg("storyclubs-no-trailer", "english")
    const args = seriesPageClientMock.mock.calls[0]?.[0]
    expect(args?.selectedVariant).toBeNull()
    expect(args?.locale).toBe("english")
  })

  it("passes raw slug-form locale (spanish-castilian) in trailer-mode, NOT bcp47-normalised", async () => {
    const watchVideo = makeWatchVideoResult("collection", {
      slug: "spanish-castilian",
      bcp47: "es",
      name: "Spanish, Castilian",
    })
    resolveWatchVideoBySlugMock.mockResolvedValue(watchVideo)
    await render2Seg("storyclubs", "spanish-castilian")
    const args = seriesPageClientMock.mock.calls[0]?.[0]
    expect(args?.locale).toBe("spanish-castilian")
  })

  it("passes raw slug-form locale in static-mode (trailerless) too", async () => {
    resolveWatchVideoBySlugMock.mockResolvedValue(null)
    resolveSeriesBySlugMock.mockResolvedValue(makeSeriesResult())
    await render2Seg("storyclubs-no-trailer", "spanish-castilian")
    const args = seriesPageClientMock.mock.calls[0]?.[0]
    expect(args?.locale).toBe("spanish-castilian")
  })
})

describe("Catch-all routing — .html shape acceptance (2-seg)", () => {
  it("strips .html from slug and locale params before dispatch (canonical shape)", async () => {
    resolveWatchVideoBySlugMock.mockResolvedValue(
      makeWatchVideoResult("collection"),
    )
    await render2Seg("storyclubs.html", "english.html")
    expect(resolveWatchVideoBySlugMock).toHaveBeenCalledWith(
      "storyclubs",
      "english",
    )
    const args = seriesPageClientMock.mock.calls[0]?.[0]
    expect(args?.locale).toBe("english")
  })

  it("handles .html suffix with slug-form locale (spanish-castilian.html)", async () => {
    resolveWatchVideoBySlugMock.mockResolvedValue(
      makeWatchVideoResult("collection", {
        slug: "spanish-castilian",
        bcp47: "es",
        name: "Spanish, Castilian",
      }),
    )
    await render2Seg("storyclubs.html", "spanish-castilian.html")
    expect(resolveWatchVideoBySlugMock).toHaveBeenCalledWith(
      "storyclubs",
      "spanish-castilian",
    )
    const args = seriesPageClientMock.mock.calls[0]?.[0]
    expect(args?.locale).toBe("spanish-castilian")
  })

  it("still accepts bare-shape input (transitional)", async () => {
    resolveWatchVideoBySlugMock.mockResolvedValue(
      makeWatchVideoResult("collection"),
    )
    await render2Seg("storyclubs", "english")
    expect(resolveWatchVideoBySlugMock).toHaveBeenCalledWith(
      "storyclubs",
      "english",
    )
  })
})

describe("Catch-all routing — slug→bcp47 family fallback for UI chrome (2-seg)", () => {
  it("renders Spanish UI chrome when URL locale is 'spanish-castilian'", async () => {
    // Non-series record so WatchPageClient receives the locale prop.
    resolveWatchVideoBySlugMock.mockResolvedValue(
      makeWatchVideoResult("shortFilm", {
        slug: "spanish-castilian",
        bcp47: "es-ES",
        name: "Spanish, Castilian",
      }),
    )
    await render2Seg("storyclubs.html", "spanish-castilian.html")
    const props = watchPageClientMock.mock.calls[0]?.[0] as {
      locale?: string
      languageSlug?: string
    }
    // languageSlug stays slug-form (audio variant + language picker UI).
    expect(props?.languageSlug).toBe("spanish-castilian")
    // locale resolves to bcp47 primary `es` (UI chrome shell language).
    expect(props?.locale).toBe("es")
  })

  it("renders Portuguese UI chrome for portuguese-brazil + portuguese-mozambique", async () => {
    resolveWatchVideoBySlugMock.mockResolvedValue(
      makeWatchVideoResult("shortFilm", {
        slug: "portuguese-brazil",
        bcp47: "pt",
        name: "Portuguese, Brazil",
      }),
    )
    await render2Seg("storyclubs.html", "portuguese-brazil.html")
    const props = watchPageClientMock.mock.calls[0]?.[0] as { locale?: string }
    expect(props?.locale).toBe("pt")
  })

  it("renders French UI chrome for french-african (ISO 639-3 fallback)", async () => {
    resolveWatchVideoBySlugMock.mockResolvedValue(
      makeWatchVideoResult("shortFilm", {
        slug: "french-african",
        bcp47: "fra",
        name: "French, African",
      }),
    )
    await render2Seg("storyclubs.html", "french-african.html")
    const props = watchPageClientMock.mock.calls[0]?.[0] as { locale?: string }
    // bcp47 'fra' (ISO 639-3) → primary 'fra' → ISO_639_3_TO_UI_LOCALE → 'fr'
    expect(props?.locale).toBe("fr")
  })

  it("falls back to DEFAULT_LOCALE='en' when language family isn't in UI_LOCALE_FAMILIES", async () => {
    // Mandarin (zh), Russian (ru), Arabic (ar), Japanese (ja), etc. — admin
    // serves the audio but apps/web UI chrome ships only en/es/fr/pt/de.
    resolveWatchVideoBySlugMock.mockResolvedValue(
      makeWatchVideoResult("shortFilm", {
        slug: "mandarin-china",
        bcp47: "zh",
        name: "Mandarin, China",
      }),
    )
    await render2Seg("storyclubs.html", "mandarin-china.html")
    const props = watchPageClientMock.mock.calls[0]?.[0] as { locale?: string }
    expect(props?.locale).toBe("en")
  })
})

describe("Catch-all routing — 3-seg episode branch", () => {
  it("renders WatchPageClient when episode + series resolve", async () => {
    resolveSeriesEpisodeBySlugMock.mockResolvedValue(makeEpisodeResult())
    await render3Seg("lumo-the-gospel-of-john", "wedding-in-cana", "english")
    expect(watchPageClientMock).toHaveBeenCalledTimes(1)
    expect(resolveSeriesEpisodeBySlugMock).toHaveBeenCalledWith(
      "lumo-the-gospel-of-john",
      "wedding-in-cana",
      "english",
    )
  })

  it("passes the LaunchDarkly CTA copy label to WatchPageClient when enabled", async () => {
    isWatchCtaTextCopyEnabledMock.mockResolvedValue(true)
    resolveSeriesEpisodeBySlugMock.mockResolvedValue(makeEpisodeResult())

    await render3Seg(
      "lumo-the-gospel-of-john.html",
      "wedding-in-cana",
      "english.html",
    )

    expect(isWatchCtaTextCopyEnabledMock).toHaveBeenCalledWith({
      custom: {
        route:
          "/watch/lumo-the-gospel-of-john.html/wedding-in-cana/english.html",
      },
    })
    expect(watchPageClientMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        downloadButtonLabel: "Save Video",
      }),
    )
  })

  it("keeps episode YouVersion passages disabled by default", async () => {
    const episodeResult = makeEpisodeResult()
    const bibleCitations = makeBibleCitations()
    ;(
      episodeResult.video as { bibleCitations?: typeof bibleCitations }
    ).bibleCitations = bibleCitations
    resolveSeriesEpisodeBySlugMock.mockResolvedValue(episodeResult)

    await render3Seg(
      "lumo-the-gospel-of-john.html",
      "wedding-in-cana",
      "english.html",
    )

    expect(isWatchYouVersionBibleQuotesEnabledMock).toHaveBeenCalledWith({
      custom: {
        route:
          "/watch/lumo-the-gospel-of-john.html/wedding-in-cana/english.html",
      },
    })
    expect(fetchYouVersionBibleQuotePassagesMock).not.toHaveBeenCalled()
    const props = watchPageClientMock.mock.calls[0]?.[0] as {
      mergedBlocks: Array<{
        kind?: string
        youVersionPassages?: Array<unknown>
      }>
    }
    expect(
      props.mergedBlocks.find((block) => block.kind === "BibleQuotes")
        ?.youVersionPassages,
    ).toEqual([])
  })

  it("passes YouVersion passages into episode Bible Quotes when the LaunchDarkly flag is enabled", async () => {
    isWatchYouVersionBibleQuotesEnabledMock.mockResolvedValue(true)
    fetchYouVersionBibleQuotePassagesMock.mockResolvedValue([
      {
        citationDocumentId: "bc-1",
        content: "Episode passage.",
        copyright: "Copyright.",
        humanReference: "John 3:16",
        publisherUrl: null,
        reference: "JHN.3.16",
        versionAbbreviation: "BSB",
        versionId: 3034,
        versionTitle: "Berean Standard Bible",
      },
    ])
    const episodeResult = makeEpisodeResult()
    const bibleCitations = makeBibleCitations()
    ;(
      episodeResult.video as { bibleCitations?: typeof bibleCitations }
    ).bibleCitations = bibleCitations
    resolveSeriesEpisodeBySlugMock.mockResolvedValue(episodeResult)

    await render3Seg(
      "lumo-the-gospel-of-john.html",
      "wedding-in-cana",
      "english.html",
    )

    expect(isWatchYouVersionBibleQuotesEnabledMock).toHaveBeenCalledWith({
      custom: {
        route:
          "/watch/lumo-the-gospel-of-john.html/wedding-in-cana/english.html",
      },
    })
    expect(fetchYouVersionBibleQuotePassagesMock).toHaveBeenCalledWith(
      bibleCitations,
    )
    const props = watchPageClientMock.mock.calls[0]?.[0] as {
      mergedBlocks: Array<{
        kind?: string
        youVersionPassages?: Array<unknown>
      }>
    }
    expect(
      props.mergedBlocks.find((block) => block.kind === "BibleQuotes")
        ?.youVersionPassages,
    ).toEqual([
      expect.objectContaining({
        content: "Episode passage.",
        reference: "JHN.3.16",
      }),
    ])
  })

  it("passes the LaunchDarkly question panel flag to WatchPageClient when enabled", async () => {
    isWatchQuestionPanelEnabledMock.mockResolvedValue(true)
    resolveSeriesEpisodeBySlugMock.mockResolvedValue(makeEpisodeResult())

    await render3Seg(
      "lumo-the-gospel-of-john.html",
      "wedding-in-cana",
      "english.html",
    )

    expect(isWatchQuestionPanelEnabledMock).toHaveBeenCalledWith({
      custom: {
        route:
          "/watch/lumo-the-gospel-of-john.html/wedding-in-cana/english.html",
      },
    })
    expect(watchPageClientMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        questionPanelEnabled: true,
      }),
    )
  })

  it("strips .html from segments 0 and 2 (canonical 3-seg shape)", async () => {
    resolveSeriesEpisodeBySlugMock.mockResolvedValue(makeEpisodeResult())
    await render3Seg(
      "lumo-the-gospel-of-john.html",
      "wedding-in-cana",
      "english.html",
    )
    expect(resolveSeriesEpisodeBySlugMock).toHaveBeenCalledWith(
      "lumo-the-gospel-of-john",
      "wedding-in-cana",
      "english",
    )
  })

  it("defensively strips .html from episode segment if present", async () => {
    resolveSeriesEpisodeBySlugMock.mockResolvedValue(makeEpisodeResult())
    await render3Seg("lumo.html", "wedding-in-cana.html", "english.html")
    expect(resolveSeriesEpisodeBySlugMock).toHaveBeenCalledWith(
      "lumo",
      "wedding-in-cana",
      "english",
    )
  })

  it("calls notFound() when resolver returns null", async () => {
    resolveSeriesEpisodeBySlugMock.mockResolvedValue(null)
    await expect(
      render3Seg("lumo", "missing-episode", "english"),
    ).rejects.toThrow("NEXT_NOT_FOUND")
    expect(notFoundMock).toHaveBeenCalledTimes(1)
    expect(watchPageClientMock).not.toHaveBeenCalled()
  })

  it("redirects to canonical .html shape when a known URL locale doesn't match selected variant", async () => {
    resolveSeriesEpisodeBySlugMock.mockResolvedValue(makeEpisodeResult())
    await expect(
      render3Seg(
        "lumo-the-gospel-of-john",
        "wedding-in-cana",
        "spanish-castilian",
      ),
    ).rejects.toThrow(
      /NEXT_REDIRECT:\/lumo-the-gospel-of-john\.html\/wedding-in-cana\/english\.html\?_lr=1/,
    )
  })

  it("does NOT redirect when URL locale matches selected variant", async () => {
    resolveSeriesEpisodeBySlugMock.mockResolvedValue(makeEpisodeResult())
    await render3Seg("lumo-the-gospel-of-john", "wedding-in-cana", "english")
    expect(redirectMock).not.toHaveBeenCalled()
    expect(watchPageClientMock).toHaveBeenCalledTimes(1)
  })

  it("404s episode bcp47 catalog keys in public audio slots", async () => {
    resolveSeriesEpisodeBySlugMock.mockResolvedValue(makeEpisodeResult())
    await expect(
      render3Seg("lumo-the-gospel-of-john", "wedding-in-cana", "en"),
    ).rejects.toThrow("NEXT_NOT_FOUND")
    expect(resolveSeriesEpisodeBySlugMock).not.toHaveBeenCalled()
  })

  it("forwards rawLocale (slug-form) into WatchPageClient", async () => {
    const result = makeEpisodeResult({
      slug: "spanish-castilian",
      bcp47: "es",
      name: "Spanish, Castilian",
    })
    resolveSeriesEpisodeBySlugMock.mockResolvedValue(result)
    await render3Seg(
      "lumo-the-gospel-of-john",
      "wedding-in-cana",
      "spanish-castilian",
    )
    const props = watchPageClientMock.mock.calls[0]?.[0] as {
      languageSlug?: string
    }
    expect(props?.languageSlug).toBe("spanish-castilian")
  })
})

describe("Catch-all routing — unknown shape", () => {
  it("calls notFound() for 4+ segments (rest.length >= 3)", async () => {
    const element = SlugRestPage({
      params: Promise.resolve({
        locale: "en",
        htmlLang: "en",
        rest: ["lumo", "a", "b", "c"],
      }),
    })
    await expect(element).rejects.toThrow("NEXT_NOT_FOUND")
    expect(notFoundMock).toHaveBeenCalledTimes(1)
  })

  it("rejects malformed segments before resolver calls", async () => {
    const element = SlugRestPage({
      params: Promise.resolve({
        locale: "en",
        htmlLang: "en",
        rest: ["bad%2Fslug.html", "english.html"],
      }),
    })
    await expect(element).rejects.toThrow("NEXT_NOT_FOUND")
    expect(resolveWatchVideoBySlugMock).not.toHaveBeenCalled()
    expect(resolveWatchPageMock).not.toHaveBeenCalled()
  })
})

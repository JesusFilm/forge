/**
 * @vitest-environment jsdom
 *
 * Catch-all route /watch/[locale]/[htmlLang]/[...rest] — segment-count
 * dispatch for public one-, two-, and three-segment watch URL shapes after
 * the proxy prepends static locale layout params.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
  resolveWatchRouteBySlugMock,
  resolveSeriesEpisodeBySlugMock,
  resolveWatchExperiencePageMock,
  resolveWatchPageMock,
  resolveWatchHomeMock,
  notFoundMock,
  redirectMock,
  seriesPageClientMock,
  watchPageClientMock,
  watchHomeExperiencePageMock,
  watchQuestionPanelMock,
  experienceEmptyMock,
  experienceErrorMock,
  isWatchCtaTextCopyEnabledMock,
  isWatchHideBibleQuotesEnabledMock,
  isWatchQuestionPanelEnabledMock,
  getInitialSubtitleTranscriptMock,
  getWatchRouteManifestMock,
  watchRouteSurfaceRegistrationMock,
} = vi.hoisted(() => ({
  resolveWatchRouteBySlugMock: vi.fn(),
  resolveSeriesEpisodeBySlugMock: vi.fn(),
  resolveWatchExperiencePageMock: vi.fn(),
  resolveWatchPageMock: vi.fn(),
  resolveWatchHomeMock: vi.fn(),
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
  watchPageClientMock: vi.fn((_props: unknown) => (
    <div data-testid="watch-page-client-mock" />
  )),
  watchHomeExperiencePageMock: vi.fn((_props: unknown) => null),
  watchQuestionPanelMock: vi.fn((_props: unknown) => null),
  experienceEmptyMock: vi.fn(() => null),
  experienceErrorMock: vi.fn(() => null),
  isWatchCtaTextCopyEnabledMock: vi.fn(async () => false),
  isWatchHideBibleQuotesEnabledMock: vi.fn(async () => false),
  isWatchQuestionPanelEnabledMock: vi.fn(async () => false),
  getInitialSubtitleTranscriptMock: vi.fn(),
  getWatchRouteManifestMock: vi.fn(),
  watchRouteSurfaceRegistrationMock: vi.fn(() => null),
}))

vi.mock("@/lib/admin-client", () => ({
  default: { query: vi.fn() },
}))

vi.mock("@/lib/content", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/content")>("@/lib/content")
  return {
    ...actual,
    resolveWatchRouteBySlug: resolveWatchRouteBySlugMock,
    resolveSeriesEpisodeBySlug: resolveSeriesEpisodeBySlugMock,
    resolveWatchExperiencePage: resolveWatchExperiencePageMock,
    resolveWatchPage: resolveWatchPageMock,
  }
})

vi.mock("@/lib/watch-home", () => ({
  resolveWatchHome: resolveWatchHomeMock,
}))

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

vi.mock("@/components/home/WatchHomeExperiencePage", () => ({
  WatchHomeExperiencePage: watchHomeExperiencePageMock,
}))

vi.mock("@/components/watch/WatchQuestionPanel", () => ({
  WatchQuestionPanel: watchQuestionPanelMock,
}))

vi.mock("@/components/WatchRouteSurfaceRegistration", () => ({
  WatchRouteSurfaceRegistration: watchRouteSurfaceRegistrationMock,
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
  isWatchHideBibleQuotesEnabled: isWatchHideBibleQuotesEnabledMock,
  isWatchQuestionPanelEnabled: isWatchQuestionPanelEnabledMock,
}))

vi.mock("@/lib/watch-transcript", () => ({
  getInitialSubtitleTranscript: getInitialSubtitleTranscriptMock,
}))

vi.mock("@/lib/watch-route-manifest", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/watch-route-manifest")
  >("@/lib/watch-route-manifest")
  return {
    ...actual,
    getWatchRouteManifest: getWatchRouteManifestMock,
  }
})

import SlugRestPage, {
  generateMetadata,
} from "@/app/[locale]/[htmlLang]/[...rest]/page"
import { resolveWatchLocaleIdentity } from "@/lib/locale"
import { stripHtmlSuffix } from "@/lib/url-shape"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  resolveWatchRouteBySlugMock.mockReset()
  resolveSeriesEpisodeBySlugMock.mockReset()
  resolveWatchExperiencePageMock.mockReset()
  resolveWatchPageMock.mockReset()
  resolveWatchHomeMock.mockReset()
  notFoundMock.mockClear()
  redirectMock.mockClear()
  // Default: no Experience curated for the slug.
  resolveWatchPageMock.mockResolvedValue({
    data: null,
    error: new Error("No experience found"),
  })
  resolveWatchHomeMock.mockResolvedValue({
    data: {
      heroSlides: [],
      sections: [],
      carousel: { pools: [], muxInserts: [] },
      missingData: [],
    },
    error: null,
  })
  resolveWatchExperiencePageMock.mockResolvedValue({
    data: null,
    error: new Error("No experience found"),
  })
  seriesPageClientMock.mockClear()
  watchPageClientMock.mockClear()
  watchHomeExperiencePageMock.mockClear()
  watchQuestionPanelMock.mockClear()
  experienceEmptyMock.mockClear()
  experienceErrorMock.mockClear()
  isWatchCtaTextCopyEnabledMock.mockReset()
  isWatchCtaTextCopyEnabledMock.mockResolvedValue(false)
  isWatchHideBibleQuotesEnabledMock.mockReset()
  isWatchHideBibleQuotesEnabledMock.mockResolvedValue(false)
  isWatchQuestionPanelEnabledMock.mockReset()
  isWatchQuestionPanelEnabledMock.mockResolvedValue(false)
  getInitialSubtitleTranscriptMock.mockReset()
  getInitialSubtitleTranscriptMock.mockResolvedValue(null)
  getWatchRouteManifestMock.mockReset()
  getWatchRouteManifestMock.mockResolvedValue(null)
  watchRouteSurfaceRegistrationMock.mockClear()
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
  const selectedVariant = {
    documentId: "var1",
    hls: "https://cdn.example/storyclubs.m3u8",
    muxVideo: { playbackId: "pb1" },
    language: variantLang,
    published: true,
    duration: 30,
    downloads: [],
  }
  return {
    video: {
      documentId: "v1",
      slug: "storyclubs",
      publishedAt: "2026-06-01T12:00:00.000Z" as string | null,
      localePublishedAt: null as string | null,
      title: "StoryClubs" as string | null,
      snippet: "StoryClubs snippet" as string | null,
      description: "StoryClubs description" as string | null,
      noIndex: false,
      label,
      imageAlt: "StoryClubs poster",
      images: [
        {
          documentId: "img-1",
          url: null,
          thumbnail: "https://cdn.example/storyclubs-thumb.jpg",
          mobileCinematicHigh: null,
          mobileCinematicLow: null,
        },
      ],
      primaryLanguage: null,
      parents: [],
      children: [],
      childDubLanguages: [],
      variants: [
        selectedVariant,
        {
          ...selectedVariant,
          documentId: "var-es",
          language: {
            slug: "spanish-castilian",
            bcp47: "es",
            name: "Spanish, Castilian",
          },
        },
      ],
      subtitles: [],
      studyQuestions: [],
      bibleCitations: [],
    },
    canonicalParent: null,
    selectedVariant,
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
      passage: {
        citationDocumentId: "bc-1",
        content: "Server passage.",
        copyright: "Copyright.",
        humanReference: "John 3:16",
        provider: "youversion",
        publisherUrl: null,
        reference: "JHN.3.16",
        versionAbbreviation: "BSB",
        versionId: 3034,
        versionTitle: "Berean Standard Bible",
      },
      verseEnd: null,
      verseStart: 16,
    },
  ]
}

function makeSeriesResult(slug = "storyclubs") {
  return {
    video: {
      documentId: "s1",
      slug,
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
      childDubLanguages: [{ slug: "english", bcp47: "en", name: "English" }],
      variants: [],
    },
    selectedVariant: null,
  }
}

function mockRouteVideo(result: ReturnType<typeof makeWatchVideoResult>) {
  resolveWatchRouteBySlugMock.mockResolvedValue({
    kind: "video",
    ...result,
  })
  return result
}

function mockRouteSeries(
  result:
    | ReturnType<typeof makeWatchVideoResult>
    | ReturnType<typeof makeSeriesResult>,
) {
  resolveWatchRouteBySlugMock.mockResolvedValue({
    kind: "series",
    ...result,
  })
  return result
}

function mockRouteNone() {
  resolveWatchRouteBySlugMock.mockResolvedValue({ kind: "none" })
}

function makeEpisodeResult(
  variantLang: { slug: string; bcp47: string; name: string } = {
    slug: "english",
    bcp47: "en",
    name: "English",
  },
) {
  const selectedVariant = {
    documentId: "var-1",
    hls: "https://cdn.example/ep.m3u8",
    muxVideo: { playbackId: "pb-1" },
    language: variantLang,
    published: true,
    duration: 30,
    downloads: [],
  }
  return {
    video: {
      documentId: "ep-1",
      slug: "wedding-in-cana",
      publishedAt: "2026-06-01T12:00:00.000Z",
      title: "Wedding in Cana",
      snippet: "Wedding in Cana snippet",
      description: "Wedding in Cana description",
      noIndex: false,
      label: "episode",
      imageAlt: "Wedding in Cana poster",
      images: [
        {
          documentId: "img-ep-1",
          url: null,
          thumbnail: null,
          mobileCinematicHigh: null,
          mobileCinematicLow: null,
        },
      ],
      children: [],
      childDubLanguages: [],
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
      primaryLanguage: null,
      variants: [selectedVariant],
      subtitles: [],
      studyQuestions: [],
      bibleCitations: [],
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
    selectedVariant,
  }
}

const pilatePageChapterSlugs = [
  "triumphal-entry",
  "jesus-cleanses-the-temple",
  "jesus-teaches-in-the-temple",
  "judas-agrees-to-betray-jesus",
  "the-last-supper",
  "jesus-prays-in-gethsemane",
  "jesus-is-arrested",
  "jesus-before-caiaphas",
  "peter-denies-jesus",
  "jesus-is-condemned-by-the-council",
  "judas-hangs-himself",
  "jesus-is-brought-to-pilate",
  "jesus-is-brought-before-herod",
  "jesus-is-sentenced",
  "jesus-is-scourged-and-mocked",
  "jesus-is-brought-to-pilate-again",
  "jesus-sentenced-to-be-crucified",
  "jesus-carries-his-cross",
  "jesus-is-nailed-to-the-cross",
  "jesus-is-crucified",
  "jesus-dies-on-the-cross",
  "jesus-is-buried",
  "the-tomb-is-guarded",
  "the-tomb-is-empty",
  "jesus-appears-to-mary",
  "resurrected-jesus-appears",
  "jesus-appears-to-his-disciples",
  "jesus-commissions-his-followers",
  "invitation-to-know-jesus-personally",
]

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

async function renderLanguageLessEpisode(series: string, episode: string) {
  const identity = internalLocaleParams("english")
  const element = await SlugRestPage({
    params: Promise.resolve({ ...identity, rest: [series, episode] }),
  })
  act(() => {
    root.render(element)
  })
}

async function renderServerHtml(rest: string[], locale: string) {
  const identity = internalLocaleParams(locale)
  const element = await SlugRestPage({
    params: Promise.resolve({ ...identity, rest }),
  })
  return renderToStaticMarkup(element)
}

function jsonLdByType(type: string): Record<string, unknown> | null {
  const scripts = Array.from(
    container.querySelectorAll('script[type="application/ld+json"]'),
  )
  for (const script of scripts) {
    const parsed = JSON.parse(script.textContent ?? "{}") as Record<
      string,
      unknown
    >
    if (parsed["@type"] === type) return parsed
  }
  return null
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
    expect(resolveWatchRouteBySlugMock).not.toHaveBeenCalled()
    expect(experienceEmptyMock).not.toHaveBeenCalled()
    expect(watchRouteSurfaceRegistrationMock).toHaveBeenCalledWith(
      { surface: "experience" },
      undefined,
    )
  })

  it("admits manifest-only one-segment Experiences and registers their resolved route surface", async () => {
    resolveWatchExperiencePageMock.mockResolvedValue({
      data: {
        kind: "experience",
        experience: {
          id: "exp-new",
          slug: "new-collection",
          title: "New Collection",
          blocks: [{ __typename: "TextBlock", id: "blk-new", text: "Hello" }],
        },
      },
      error: null,
    })

    await render1Seg("new-collection.html")

    expect(resolveWatchExperiencePageMock).toHaveBeenCalledWith(
      "en",
      "new-collection",
    )
    expect(watchRouteSurfaceRegistrationMock).toHaveBeenCalledWith(
      { surface: "experience" },
      undefined,
    )
  })

  it("passes the exact public language slug to localized-home content while retaining the resolved UI locale", async () => {
    resolveWatchHomeMock.mockResolvedValue({
      data: {
        heroSlides: [{ id: "hero-es" }],
        sections: [],
        carousel: { pools: [], muxInserts: [] },
        missingData: [],
      },
      error: null,
    })
    resolveWatchPageMock.mockResolvedValue({
      data: {
        kind: "experience",
        experience: {
          id: "exp-home-es",
          slug: "watch-home",
          title: "Watch Home",
          blocks: [],
        },
      },
      error: null,
    })

    await render1Seg("spanish-castilian.html")

    expect(resolveWatchHomeMock).toHaveBeenCalledWith("es", "spanish-castilian")
    expect(redirectMock).not.toHaveBeenCalled()
    expect(watchHomeExperiencePageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        heroModel: {
          heroSlides: [{ id: "hero-es" }],
          sections: [],
          carousel: { pools: [], muxInserts: [] },
          missingData: [],
        },
        blocks: [],
      }),
      undefined,
    )
    expect(resolveWatchPageMock).toHaveBeenCalledWith("es")
    expect(resolveWatchExperiencePageMock).not.toHaveBeenCalled()
    expect(resolveWatchRouteBySlugMock).not.toHaveBeenCalled()
    expect(watchRouteSurfaceRegistrationMock).toHaveBeenCalledWith(
      { surface: "language-home" },
      undefined,
    )
  })

  it("emits localized CollectionPage JSON-LD from the initial server hero", async () => {
    resolveWatchHomeMock.mockResolvedValue({
      data: {
        heroSlides: [
          {
            id: "hero-es",
            coreId: "hero-es",
            title: "JESÚS",
            href: "/watch/jesus.html/spanish-castilian.html",
          },
        ],
        sections: [],
        carousel: { pools: [], muxInserts: [] },
        missingData: [],
      },
      error: null,
    })
    resolveWatchPageMock.mockResolvedValue({
      data: {
        kind: "experience",
        experience: {
          id: "exp-home-es",
          slug: "watch-home",
          title: "Watch Home",
          blocks: [],
        },
      },
      error: null,
    })

    const html = await renderServerHtml(
      ["spanish-castilian.html"],
      "spanish-castilian",
    )
    const document = new DOMParser().parseFromString(html, "text/html")
    const payload = JSON.parse(
      document.querySelector('script[type="application/ld+json"]')
        ?.textContent ?? "{}",
    )

    expect(payload).toMatchObject({
      url: "https://www.jesusfilm.org/watch/spanish-castilian.html",
      inLanguage: "es-ES",
      mainEntity: {
        itemListElement: [
          {
            position: 1,
            name: "JESÚS",
            url: "https://www.jesusfilm.org/watch/jesus.html/spanish-castilian.html",
          },
        ],
      },
    })
  })

  it("redirects a missing localized home to the same language's video inventory", async () => {
    resolveWatchHomeMock.mockResolvedValue({
      data: {
        heroSlides: [{ id: "hero-ru" }],
        sections: [],
        carousel: { pools: [], muxInserts: [] },
        missingData: [],
      },
      error: null,
    })

    await expect(render1Seg("russian.html")).rejects.toThrow(
      "NEXT_REDIRECT:/russian.html/videos",
    )

    expect(resolveWatchHomeMock).toHaveBeenCalledWith("ru", "russian")
    expect(resolveWatchPageMock).toHaveBeenCalledWith("ru")
    expect(redirectMock).toHaveBeenCalledWith("/russian.html/videos")
    expect(watchHomeExperiencePageMock).not.toHaveBeenCalled()
    expect(experienceEmptyMock).not.toHaveBeenCalled()
  })

  it("does not treat an operational localized-home error as missing content", async () => {
    resolveWatchHomeMock.mockResolvedValue({
      data: {
        heroSlides: [{ id: "hero-ru" }],
        sections: [],
        carousel: { pools: [], muxInserts: [] },
        missingData: [],
      },
      error: null,
    })
    resolveWatchPageMock.mockResolvedValue({
      data: null,
      error: new Error("Admin unavailable"),
    })

    await render1Seg("russian.html")

    expect(redirectMock).not.toHaveBeenCalled()
    expect(watchHomeExperiencePageMock).toHaveBeenCalled()
  })

  it("canonicalizes one-segment language-home metadata to the public language URL", async () => {
    resolveWatchPageMock.mockResolvedValue({
      data: null,
      error: null,
    })

    const metadata = await generateMetadata({
      params: Promise.resolve({
        locale: "de",
        htmlLang: "de",
        rest: ["german-standard.html"],
      }),
    })

    expect(metadata.alternates?.canonical).toBe(
      "https://www.jesusfilm.org/watch/german-standard.html",
    )
    expect(metadata.openGraph?.url).toBe(
      "https://www.jesusfilm.org/watch/german-standard.html",
    )
    expect(resolveWatchPageMock).toHaveBeenCalledWith("de", undefined)
  })

  it("lets the proxy-admitted one-segment Experience resolver own misses", async () => {
    resolveWatchExperiencePageMock.mockResolvedValue({
      data: null,
      error: new Error("No experience found"),
    })

    await expect(render1Seg("jesus.html")).rejects.toThrow("NEXT_NOT_FOUND")

    expect(resolveWatchExperiencePageMock).toHaveBeenCalledWith("en", "jesus")
    expect(resolveWatchPageMock).not.toHaveBeenCalled()
    expect(resolveWatchRouteBySlugMock).not.toHaveBeenCalled()
    expect(notFoundMock).toHaveBeenCalledTimes(1)
    expect(experienceEmptyMock).not.toHaveBeenCalled()
  })

  it("does not run one-segment non-language slugs through the default Watch-page resolver", async () => {
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

    expect(resolveWatchExperiencePageMock).toHaveBeenCalledWith("en", "jesus")
    expect(resolveWatchPageMock).not.toHaveBeenCalled()
    expect(notFoundMock).toHaveBeenCalledTimes(1)
    expect(experienceEmptyMock).not.toHaveBeenCalled()
  })
})

describe("Catch-all routing — route-surface registration", () => {
  it("registers explicit English compatibility and internal rewrite pages as English video surfaces", async () => {
    mockRouteVideo(makeWatchVideoResult("featureFilm"))

    await render2Seg("storyclubs.html", "english.html")

    expect(watchRouteSurfaceRegistrationMock).toHaveBeenCalledWith(
      { surface: "english-video" },
      undefined,
    )
  })
})

describe("Catch-all routing — metadata for playable watch pages", () => {
  it("uses resolved video data for two-segment metadata without page-head hreflang", async () => {
    mockRouteVideo(makeWatchVideoResult("featureFilm"))

    const metadata = await generateMetadata({
      params: Promise.resolve({
        locale: "en",
        htmlLang: "en",
        rest: ["storyclubs.html", "english.html"],
      }),
    })

    expect(metadata.title).toBe("StoryClubs | Jesus Film Project")
    expect(metadata.description).toBe("StoryClubs description")
    expect(metadata.openGraph).toMatchObject({
      title: "StoryClubs | Jesus Film Project",
      url: "https://www.jesusfilm.org/watch/storyclubs.html",
      images: [
        {
          url: "https://image.mux.com/pb1/thumbnail.jpg?width=1200&height=630&fit_mode=smartcrop",
          alt: "StoryClubs poster",
        },
      ],
    })
    expect(metadata.twitter).toMatchObject({
      title: "StoryClubs | Jesus Film Project",
      images: [
        {
          url: "https://image.mux.com/pb1/thumbnail.jpg?width=1200&height=630&fit_mode=smartcrop",
          alt: "StoryClubs poster",
        },
      ],
    })
    expect(metadata.alternates).toMatchObject({
      canonical: "https://www.jesusfilm.org/watch/storyclubs.html",
    })
    expect(metadata.alternates).not.toHaveProperty("languages")
    expect(resolveWatchPageMock).not.toHaveBeenCalled()
    expect(resolveWatchRouteBySlugMock).toHaveBeenCalledWith(
      "storyclubs",
      "english",
    )
  })

  it("keeps same-slug video metadata ahead of curated Experience metadata", async () => {
    resolveWatchPageMock.mockResolvedValue({
      data: {
        kind: "experience",
        experience: {
          id: "exp-1",
          slug: "easter",
          title: "Easter Watch",
          metaDescription: "Curated Easter page.",
          ogTitle: "Easter OG",
          ogDescription: "Curated Easter OG.",
          ogImageUrl: "https://cdn.example/easter-og.jpg",
          blocks: [{ __typename: "TextBlock", id: "blk-1", text: "Hello" }],
        },
      },
      error: null,
    })
    const watchVideoResult = makeWatchVideoResult("featureFilm")
    watchVideoResult.video.slug = "easter"
    mockRouteVideo(watchVideoResult)

    const metadata = await generateMetadata({
      params: Promise.resolve({
        locale: "en",
        htmlLang: "en",
        rest: ["easter.html", "english.html"],
      }),
    })

    expect(metadata.title).toBe("StoryClubs | Jesus Film Project")
    expect(metadata.openGraph).toMatchObject({
      title: "StoryClubs | Jesus Film Project",
      url: "https://www.jesusfilm.org/watch/easter.html",
      images: [
        {
          url: "https://image.mux.com/pb1/thumbnail.jpg?width=1200&height=630&fit_mode=smartcrop",
        },
      ],
    })
    expect(resolveWatchRouteBySlugMock).toHaveBeenCalledWith(
      "easter",
      "english",
    )
    expect(resolveWatchPageMock).not.toHaveBeenCalled()
  })

  it("keeps same-slug trailerless series metadata ahead of curated Experience metadata", async () => {
    resolveWatchPageMock.mockResolvedValue({
      data: {
        kind: "experience",
        experience: {
          id: "exp-1",
          slug: "easter",
          title: "Easter Watch",
          metaDescription: "Curated Easter page.",
          blocks: [{ __typename: "TextBlock", id: "blk-1", text: "Hello" }],
        },
      },
      error: null,
    })
    mockRouteSeries(makeSeriesResult("easter"))

    const metadata = await generateMetadata({
      params: Promise.resolve({
        locale: "en",
        htmlLang: "en",
        rest: ["easter.html", "english.html"],
      }),
    })

    expect(metadata.title).toBe("StoryClubs | Jesus Film Project")
    expect(metadata.openGraph).toMatchObject({
      title: "StoryClubs | Jesus Film Project",
      url: "https://www.jesusfilm.org/watch/easter.html",
    })
    expect(resolveWatchRouteBySlugMock).toHaveBeenCalledWith(
      "easter",
      "english",
    )
    expect(resolveWatchPageMock).not.toHaveBeenCalled()
  })

  it("uses lightweight fallback metadata when watch route resolution throws", async () => {
    resolveWatchRouteBySlugMock.mockRejectedValue(
      new Error("You are trying to access 'videoBySlug' too often"),
    )

    const metadata = await generateMetadata({
      params: Promise.resolve({
        locale: "en",
        htmlLang: "en",
        rest: ["easter.html", "english.html"],
      }),
    })

    expect(metadata.title).toBe("easter | Jesus Film Project")
    expect(metadata.alternates?.canonical).toBe(
      "https://www.jesusfilm.org/watch/easter.html",
    )
    expect(resolveWatchPageMock).not.toHaveBeenCalled()
  })

  it("uses the standalone video identity for episode metadata", async () => {
    resolveSeriesEpisodeBySlugMock.mockResolvedValue(makeEpisodeResult())

    const metadata = await generateMetadata({
      params: Promise.resolve({
        locale: "en",
        htmlLang: "en",
        rest: [
          "lumo-the-gospel-of-john.html",
          "wedding-in-cana",
          "english.html",
        ],
      }),
    })

    expect(metadata.title).toBe("Wedding in Cana | Jesus Film Project")
    expect(metadata.openGraph).toMatchObject({
      url: "https://www.jesusfilm.org/watch/wedding-in-cana.html",
      images: [
        {
          url: "https://image.mux.com/pb-1/thumbnail.jpg?width=1200&height=630&fit_mode=smartcrop",
          alt: "Wedding in Cana poster",
        },
      ],
    })
    expect(metadata.alternates?.canonical).toBe(
      "https://www.jesusfilm.org/watch/wedding-in-cana.html",
    )
  })
})

describe("Catch-all routing — series branch (2-seg)", () => {
  it("renders SeriesPageClient when route resolver returns a COLLECTION-labeled record", async () => {
    mockRouteSeries(makeWatchVideoResult("collection"))
    await render2Seg("storyclubs", "english")
    expect(seriesPageClientMock).toHaveBeenCalledTimes(1)
    expect(watchPageClientMock).not.toHaveBeenCalled()
    expect(
      container.querySelector('[data-testid="watch-home-footer"]'),
    ).toBeNull()
  })

  it("renders SeriesPageClient when label is 'series' (defensive OR)", async () => {
    mockRouteSeries(makeWatchVideoResult("series"))
    await render2Seg("any-series", "english")
    expect(seriesPageClientMock).toHaveBeenCalledTimes(1)
    expect(watchPageClientMock).not.toHaveBeenCalled()
  })

  it("emits an indexable series CollectionPage with standalone child entities", async () => {
    mockRouteSeries(makeSeriesResult("storyclubs"))
    getWatchRouteManifestMock.mockResolvedValue({
      version: "test",
      generatedAt: "2026-07-23T00:00:00.000Z",
      contentSlugs: ["ep-1"],
      oneSegmentSlugs: [],
      episodePairsByParent: {},
      audioLanguageSlugs: ["english"],
      audioLanguageIndexesByContent: { "ep-1": [0] },
    })

    const html = await renderServerHtml(
      ["storyclubs.html", "english.html"],
      "english",
    )
    const document = new DOMParser().parseFromString(html, "text/html")
    const payload = JSON.parse(
      document.querySelector('script[type="application/ld+json"]')
        ?.textContent ?? "{}",
    )

    expect(payload).toMatchObject({
      name: "StoryClubs",
      url: "https://www.jesusfilm.org/watch/storyclubs.html",
      inLanguage: "en",
      mainEntity: {
        itemListElement: [
          {
            position: 1,
            name: "Ep 1",
            url: "https://www.jesusfilm.org/watch/ep-1.html",
          },
        ],
      },
    })
  })

  it("redirects series routes to the language used by visible episode cards", async () => {
    const result = makeSeriesResult("storyclubs")
    result.video.childDubLanguages = [
      {
        slug: "spanish-castilian",
        bcp47: "es-ES",
        name: "Spanish, Castilian",
      },
    ]
    mockRouteSeries(result)

    await expect(render2Seg("storyclubs", "english")).rejects.toThrow(
      "NEXT_REDIRECT:/storyclubs.html/spanish-castilian.html?_lr=1",
    )
    expect(seriesPageClientMock).not.toHaveBeenCalled()
  })

  it("omits collection JSON-LD for noIndex series without changing its UI", async () => {
    const result = makeSeriesResult("storyclubs")
    ;(result.video as typeof result.video & { noIndex: boolean }).noIndex = true
    mockRouteSeries(result)

    await render2Seg("storyclubs", "english")

    expect(seriesPageClientMock).toHaveBeenCalledTimes(1)
    expect(jsonLdByType("CollectionPage")).toBeNull()
  })

  it("renders WatchPageClient when label is non-series (regression guard)", async () => {
    mockRouteVideo(makeWatchVideoResult("featureFilm"))
    await render2Seg("jesus", "english")
    expect(watchPageClientMock).toHaveBeenCalledTimes(1)
    expect(watchPageClientMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        hideBibleQuotes: false,
        questionPanelEnabled: false,
      }),
    )
    expect(seriesPageClientMock).not.toHaveBeenCalled()
    expect(
      Array.from(
        container.querySelectorAll(
          '[data-testid="watch-page-client-mock"], [data-testid="watch-home-footer"]',
        ),
        (element) => element.getAttribute("data-testid"),
      ),
    ).toEqual(["watch-page-client-mock", "watch-home-footer"])
  })

  it("builds ordered standalone collection choices from exact admitted current-language routes", async () => {
    const result = makeWatchVideoResult("featureFilm")
    const child = (documentId: string, slug: string, title: string) => ({
      documentId,
      slug,
      title,
      label: "episode",
      images: [],
      durationSeconds: 30,
      muxPlaybackId: `mux-${documentId}`,
      muxThumbnailBlurDataUrl: null,
    })
    const current = child("v1", "storyclubs", "StoryClubs")
    const ownChildren = [
      child("own-1", "own-one", "Own One"),
      child("own-2", "own-two", "Own Two"),
    ]
    const parents = [
      {
        documentId: "parent-a",
        slug: "collection-a",
        title: "Collection A",
        noIndex: false,
        label: "collection",
        images: [],
        children: [
          current,
          child("a-2", "a-two", "A Two"),
          child("a-3", "a-three", "A Three"),
        ],
      },
      {
        documentId: "parent-missing-current",
        slug: "missing-current",
        title: "Missing Current",
        noIndex: false,
        label: "collection",
        images: [],
        children: [current, child("m-2", "m-two", "M Two")],
      },
      {
        documentId: "parent-too-short",
        slug: "too-short",
        title: "Too Short",
        noIndex: false,
        label: "collection",
        images: [],
        children: [current, child("s-2", "s-two", "S Two")],
      },
      {
        documentId: "parent-invalid-slug",
        slug: "Not Public",
        title: "Invalid Slug",
        noIndex: false,
        label: "collection",
        images: [],
        children: [current, child("i-2", "i-two", "I Two")],
      },
      {
        documentId: "parent-b",
        slug: "collection-b",
        title: "Collection B",
        noIndex: false,
        label: "collection",
        images: [],
        children: [
          child("b-1", "b-one", "B One"),
          current,
          child("b-es", "b-spanish", "Spanish Only"),
        ],
      },
    ]
    ;(
      result.video as unknown as {
        children: typeof ownChildren
        parents: typeof parents
      }
    ).children = ownChildren
    ;(
      result.video as unknown as {
        children: typeof ownChildren
        parents: typeof parents
      }
    ).parents = parents
    getWatchRouteManifestMock.mockResolvedValue({
      version: "1",
      generatedAt: "2026-07-22T12:00:00.000Z",
      contentSlugs: [],
      oneSegmentSlugs: [],
      episodePairsByParent: {
        "collection-a": ["storyclubs", "a-two", "a-three"],
        "missing-current": ["m-two"],
        "too-short": ["storyclubs"],
        "collection-b": ["b-one", "storyclubs", "b-spanish"],
      },
      audioLanguageSlugs: ["english", "spanish-castilian"],
      audioLanguageIndexesByEpisode: {
        "collection-a": { storyclubs: [0], "a-two": [0], "a-three": [1] },
        "missing-current": { "m-two": [0] },
        "too-short": { storyclubs: [0] },
        "collection-b": {
          "b-one": [0],
          storyclubs: [0],
          "b-spanish": [1],
        },
      },
    })
    mockRouteVideo(result)

    await render2Seg("storyclubs", "english")

    const props = watchPageClientMock.mock.calls[0]?.[0] as {
      mergedBlocks: Array<{
        kind?: string
        video?: { documentId?: string; slug?: string }
        nextWatchItem?: { parentSlug?: string } | null
        canonicalParent?: { slug?: string; children?: Array<{ slug: string }> }
        selectableParents?: Array<{
          slug: string
          children: Array<{ slug: string }>
        }>
      }>
    }
    const carousel = props.mergedBlocks.find(
      (block) => block.kind === "SiblingCarousel",
    )
    expect(carousel?.selectableParents?.map((parent) => parent.slug)).toEqual([
      "collection-a",
      "collection-b",
    ])
    expect(
      carousel?.selectableParents?.map((parent) =>
        parent.children.map((entry) => entry.slug),
      ),
    ).toEqual([
      ["storyclubs", "a-two"],
      ["b-one", "storyclubs"],
    ])
    expect(carousel?.canonicalParent?.slug).toBe("collection-a")
    expect(carousel?.canonicalParent?.children).toHaveLength(2)
    const hero = props.mergedBlocks.find((block) => block.kind === "HeroPlayer")
    expect(hero?.nextWatchItem).toMatchObject({
      parentSlug: "storyclubs",
      slug: "own-one",
      documentId: "own-1",
    })
    expect(
      props.mergedBlocks.find((block) => block.kind === "Share")?.video,
    ).toMatchObject({ documentId: "v1", slug: "storyclubs" })
    expect(jsonLdByType("BreadcrumbList")).toBeNull()
    expect(jsonLdByType("ItemList")).toMatchObject({
      itemListElement: [
        {
          position: 1,
          name: "StoryClubs",
          url: "https://www.jesusfilm.org/watch/storyclubs.html",
        },
        {
          position: 2,
          name: "A Two",
          url: "https://www.jesusfilm.org/watch/a-two.html",
        },
      ],
    })
  })

  it("keeps the standalone own-children fallback when the manifest is unavailable", async () => {
    const result = makeWatchVideoResult("featureFilm")
    const ownChildren = [
      {
        documentId: "own-1",
        slug: "own-one",
        title: "Own One",
        label: "episode",
        images: [],
        durationSeconds: 30,
        muxPlaybackId: "mux-own-1",
        muxThumbnailBlurDataUrl: null,
      },
      {
        documentId: "own-2",
        slug: "own-two",
        title: "Own Two",
        label: "episode",
        images: [],
        durationSeconds: 30,
        muxPlaybackId: "mux-own-2",
        muxThumbnailBlurDataUrl: null,
      },
    ]
    ;(result.video as unknown as { children: typeof ownChildren }).children =
      ownChildren
    getWatchRouteManifestMock.mockResolvedValue(null)
    mockRouteVideo(result)

    await render2Seg("storyclubs", "english")

    const props = watchPageClientMock.mock.calls[0]?.[0] as {
      mergedBlocks: Array<{
        kind?: string
        canonicalParent?: { slug?: string }
        selectableParents?: unknown
      }>
    }
    const carousel = props.mergedBlocks.find(
      (block) => block.kind === "SiblingCarousel",
    )
    expect(carousel?.canonicalParent?.slug).toBe("storyclubs")
    expect(carousel).not.toHaveProperty("selectableParents")
  })

  it("starts the route manifest request alongside standalone video resolution", async () => {
    let resolveRoute!: (value: unknown) => void
    let resolveManifest!: (value: null) => void
    resolveWatchRouteBySlugMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRoute = resolve
      }),
    )
    getWatchRouteManifestMock.mockReturnValue(
      new Promise((resolve) => {
        resolveManifest = resolve
      }),
    )

    const renderPromise = render2Seg("storyclubs", "english")
    await vi.waitFor(() => {
      expect(resolveWatchRouteBySlugMock).toHaveBeenCalledWith(
        "storyclubs",
        "english",
      )
      expect(getWatchRouteManifestMock).toHaveBeenCalledTimes(1)
    })

    resolveRoute({
      kind: "video",
      ...makeWatchVideoResult("featureFilm"),
    })
    resolveManifest(null)
    await renderPromise
  })

  it("defers transcript cues and prunes client variant rows", async () => {
    const watchVideoResult = makeWatchVideoResult("featureFilm")
    const carouselChildren = [
      {
        documentId: "chapter-1",
        slug: "chapter-1",
        title: "Chapter 1",
        label: "episode",
        images: [],
        durationSeconds: 30,
        muxPlaybackId: "chapter-pb-1",
      },
      {
        documentId: "chapter-2",
        slug: "chapter-2",
        title: "Chapter 2",
        label: "episode",
        images: [],
        durationSeconds: 30,
        muxPlaybackId: "chapter-pb-2",
      },
    ]
    const watchVideo = watchVideoResult.video as unknown as {
      children: typeof carouselChildren
      parents: Array<{
        documentId: string
        slug: string
        title: string
        noIndex: boolean
        label: string
        images: unknown[]
        children: typeof carouselChildren
      }>
      studyQuestions: Array<{
        documentId: string
        value: string
        order: number
      }>
      bibleCitations: ReturnType<typeof makeBibleCitations>
    }
    watchVideo.children = carouselChildren
    watchVideo.parents = [
      {
        documentId: "parent-1",
        slug: "jesus",
        title: "Jesus",
        noIndex: false,
        label: "collection",
        images: [],
        children: carouselChildren,
      },
    ]
    watchVideo.studyQuestions = [
      { documentId: "sq-1", value: "What changed?", order: 1 },
    ]
    watchVideo.bibleCitations = makeBibleCitations()
    mockRouteVideo(watchVideoResult)

    await render2Seg("jesus", "english")

    const props = watchPageClientMock.mock.calls[0]?.[0] as {
      initialTranscript?: unknown
      variant: { videoEdition: unknown }
      video: {
        parents: unknown[]
        children: unknown[]
        variants: Array<{ videoEdition: unknown }>
        studyQuestions: unknown[]
        bibleCitations: unknown[]
      }
      mergedBlocks: Array<{
        kind?: string
        playableLanguageCount?: number
        variant?: { videoEdition: unknown }
        video?: {
          parents: unknown[]
          children: unknown[]
          variants: Array<{ videoEdition: unknown }>
          studyQuestions: unknown[]
          bibleCitations: unknown[]
        }
        canonicalParent?: { children: unknown[] }
      }>
    }
    expect(props.initialTranscript).toBeNull()
    expect(props.variant.videoEdition).toBeNull()
    expect(props.video.parents).toEqual([])
    expect(props.video.children).toEqual([])
    expect(props.video.studyQuestions).toEqual([])
    expect(props.video.bibleCitations).toEqual([])
    expect(props.video.variants).toHaveLength(1)
    expect(props.video.variants[0]?.videoEdition).toBeNull()
    const hero = props.mergedBlocks.find((block) => block.kind === "HeroPlayer")
    expect(hero?.playableLanguageCount).toBe(2)
    expect(hero?.variant?.videoEdition).toBeNull()
    expect(hero?.video?.parents).toEqual([])
    expect(hero?.video?.children).toEqual([])
    expect(hero?.video?.variants).toHaveLength(1)
    expect(hero?.video?.variants[0]?.videoEdition).toBeNull()
    const body = props.mergedBlocks.find((block) => block.kind === "WatchBody")
    expect(body?.video?.parents).toEqual([])
    expect(body?.video?.children).toEqual([])
    const carousel = props.mergedBlocks.find(
      (block) => block.kind === "SiblingCarousel",
    )
    expect(carousel?.canonicalParent?.children).toHaveLength(2)
  })

  it("renders a sanitized VideoObject JSON-LD script for playable videos", async () => {
    const watchVideoResult = makeWatchVideoResult("featureFilm")
    watchVideoResult.video.title = "Story < Clubs"
    watchVideoResult.video.description = "Story < Clubs description"
    mockRouteVideo(watchVideoResult)

    await render2Seg("storyclubs", "english")

    const script = container.querySelector('script[type="application/ld+json"]')
    expect(script?.textContent).not.toContain("<")
    expect(JSON.parse(script?.textContent ?? "{}")).toMatchObject({
      "@type": "VideoObject",
      name: "Story < Clubs",
      description: "Story < Clubs description",
      url: "https://www.jesusfilm.org/watch/storyclubs.html",
      contentUrl: "https://cdn.example/storyclubs.m3u8",
      thumbnailUrl: [
        "https://image.mux.com/pb1/thumbnail.jpg?width=1200&height=630&fit_mode=smartcrop",
      ],
      inLanguage: "en",
      uploadDate: "2026-06-01T12:00:00.000Z",
      duration: "PT30S",
      publisher: {
        "@type": "Organization",
        name: "Jesus Film Project",
      },
      potentialAction: {
        "@type": "SeekToAction",
        target:
          "https://www.jesusfilm.org/watch/storyclubs.html?t={seek_to_second_number}",
        "startOffset-input": "required name=seek_to_second_number",
      },
    })
    expect(script?.textContent).not.toContain("embedUrl")
  })

  it("includes parsed VideoObject JSON-LD in pre-hydration server HTML", async () => {
    mockRouteVideo(makeWatchVideoResult("featureFilm"))

    const html = await renderServerHtml(
      ["storyclubs.html", "english.html"],
      "english",
    )
    const document = new DOMParser().parseFromString(html, "text/html")
    const scripts = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]'),
    ).map((script) => JSON.parse(script.textContent ?? "{}"))

    expect(
      scripts.filter((script) => script["@type"] === "VideoObject"),
    ).toHaveLength(1)
    expect(
      scripts.find((script) => script["@type"] === "VideoObject"),
    ).toMatchObject({
      url: "https://www.jesusfilm.org/watch/storyclubs.html",
    })
  })

  it("renders sparse playable video JSON-LD with structured-data fallbacks", async () => {
    const watchVideoResult = makeWatchVideoResult("featureFilm")
    watchVideoResult.video.description = null
    watchVideoResult.video.snippet = null
    watchVideoResult.video.publishedAt = null
    watchVideoResult.video.localePublishedAt = "2026-06-02T12:00:00.000Z"
    mockRouteVideo(watchVideoResult)

    await render2Seg("storyclubs", "english")

    expect(jsonLdByType("VideoObject")).toMatchObject({
      "@type": "VideoObject",
      name: "StoryClubs",
      description: "Watch StoryClubs from Jesus Film Project.",
      uploadDate: "2026-06-02T12:00:00.000Z",
      contentUrl: "https://cdn.example/storyclubs.m3u8",
    })
  })

  it("passes server-formatted compact transcript text to the client when subtitles exist", async () => {
    const watchVideoResult = makeWatchVideoResult("featureFilm")
    const subtitles = [
      {
        documentId: "sub-en",
        language: {
          slug: "english",
          name: "English",
          nativeName: null,
          bcp47: "en",
        },
        vttSrc: "https://cdn.example/storyclubs.vtt",
        primary: true,
        aiGenerated: false,
      },
    ]
    ;(watchVideoResult.video as { subtitles: typeof subtitles }).subtitles =
      subtitles
    const initialTranscript = {
      vttSrc: "https://cdn.example/storyclubs.vtt",
      compactText: "In the beginning\n\nThe story continues",
    }
    getInitialSubtitleTranscriptMock.mockResolvedValue(initialTranscript)
    mockRouteVideo(watchVideoResult)

    await render2Seg("storyclubs", "english")

    expect(getInitialSubtitleTranscriptMock).toHaveBeenCalledWith({
      subtitles,
      audioSlug: "english",
    })
    expect(watchPageClientMock.mock.calls[0]?.[0]).toMatchObject({
      initialTranscript,
    })
    expect(jsonLdByType("VideoObject")).toMatchObject({
      caption: [
        {
          "@type": "MediaObject",
          contentUrl: "https://cdn.example/storyclubs.vtt",
          encodingFormat: "text/vtt",
          inLanguage: "en",
        },
      ],
    })
  })

  it("renders bounded related-item JSON-LD without schema-only breadcrumbs", async () => {
    const watchVideoResult = makeWatchVideoResult("featureFilm")
    const carouselChildren = [
      {
        documentId: "video-1",
        slug: "storyclubs",
        title: "StoryClubs",
        label: "episode",
        images: [
          {
            documentId: "img-storyclubs",
            url: null,
            thumbnail: "https://cdn.example/storyclubs-thumb.jpg",
            mobileCinematicHigh: "https://cdn.example/storyclubs-high.jpg",
            mobileCinematicLow: null,
          },
        ],
        durationSeconds: 30,
        muxPlaybackId: null,
        muxThumbnailBlurDataUrl: null,
      },
      {
        documentId: "video-2",
        slug: "another-story",
        title: "Another Story",
        label: "episode",
        images: [],
        durationSeconds: null,
        muxPlaybackId: null,
        muxThumbnailBlurDataUrl: null,
      },
    ]
    ;(
      watchVideoResult.video as { children: typeof carouselChildren }
    ).children = carouselChildren
    const parents = [
      {
        documentId: "parent-1",
        slug: "jesus",
        title: "Jesus",
        noIndex: false,
        label: "collection",
        images: [],
        children: carouselChildren,
      },
    ]
    ;(watchVideoResult.video as { parents: typeof parents }).parents = parents
    ;(
      watchVideoResult as unknown as {
        canonicalParent: (typeof parents)[number]
      }
    ).canonicalParent = parents[0]!
    mockRouteVideo(watchVideoResult)

    await render2Seg("storyclubs", "english")

    expect(jsonLdByType("BreadcrumbList")).toBeNull()
    expect(jsonLdByType("ItemList")).toMatchObject({
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "StoryClubs",
          url: "https://www.jesusfilm.org/watch/storyclubs.html",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Another Story",
          url: "https://www.jesusfilm.org/watch/another-story.html",
        },
      ],
    })
  })

  it("suppresses all JSON-LD for noIndex videos without hiding the page", async () => {
    const watchVideoResult = makeWatchVideoResult("featureFilm")
    watchVideoResult.video.noIndex = true
    const carouselChildren = [
      {
        documentId: "video-1",
        slug: "storyclubs",
        title: "StoryClubs",
        label: "episode",
        images: [],
        durationSeconds: 30,
        muxPlaybackId: null,
        muxThumbnailBlurDataUrl: null,
      },
    ]
    ;(
      watchVideoResult.video as { children: typeof carouselChildren }
    ).children = carouselChildren
    const parent = {
      documentId: "parent-1",
      slug: "jesus",
      title: "Jesus",
      noIndex: false,
      label: "collection",
      images: [],
      children: carouselChildren,
    }
    ;(watchVideoResult.video as { parents: (typeof parent)[] }).parents = [
      parent,
    ]
    ;(
      watchVideoResult as unknown as { canonicalParent: typeof parent }
    ).canonicalParent = parent
    mockRouteVideo(watchVideoResult)

    await render2Seg("storyclubs", "english")

    expect(watchPageClientMock).toHaveBeenCalledTimes(1)
    expect(
      container.querySelectorAll('script[type="application/ld+json"]'),
    ).toHaveLength(0)
  })

  it("404s bcp47 catalog keys in public audio slots", async () => {
    await expect(render2Seg("jesus", "en")).rejects.toThrow("NEXT_NOT_FOUND")
    expect(resolveWatchRouteBySlugMock).not.toHaveBeenCalled()
  })

  it("404s unknown public audio slugs before content or experience lookup", async () => {
    await expect(render2Seg("easter", "non-existent")).rejects.toThrow(
      "NEXT_NOT_FOUND",
    )

    expect(resolveWatchPageMock).not.toHaveBeenCalled()
    expect(resolveWatchRouteBySlugMock).not.toHaveBeenCalled()
  })

  it("passes Admin-resolved Bible passages through the Bible Quotes block", async () => {
    const watchVideoResult = makeWatchVideoResult("featureFilm")
    const bibleCitations = makeBibleCitations()
    ;(
      watchVideoResult.video as { bibleCitations?: typeof bibleCitations }
    ).bibleCitations = bibleCitations
    mockRouteVideo(watchVideoResult)

    await render2Seg("jesus.html", "english.html")

    const props = watchPageClientMock.mock.calls[0]?.[0] as {
      mergedBlocks: Array<{
        kind?: string
        passages?: Array<unknown>
      }>
    }
    expect(
      props.mergedBlocks.find((block) => block.kind === "BibleQuotes")
        ?.passages,
    ).toEqual([
      expect.objectContaining({
        content: "Server passage.",
        reference: "JHN.3.16",
      }),
    ])
  })

  it("passes the Bible Quotes hide flag to WatchPageClient when enabled", async () => {
    isWatchHideBibleQuotesEnabledMock.mockResolvedValue(true)
    const watchVideoResult = makeWatchVideoResult("featureFilm")
    const bibleCitations = makeBibleCitations()
    ;(
      watchVideoResult.video as { bibleCitations?: typeof bibleCitations }
    ).bibleCitations = bibleCitations
    mockRouteVideo(watchVideoResult)

    await render2Seg("jesus.html", "english.html")

    expect(isWatchHideBibleQuotesEnabledMock).toHaveBeenCalledWith({
      custom: { route: "/watch/jesus.html/english.html" },
    })
    expect(watchPageClientMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        hideBibleQuotes: true,
      }),
    )
  })

  it("passes the LaunchDarkly CTA copy label to WatchPageClient when enabled", async () => {
    isWatchCtaTextCopyEnabledMock.mockResolvedValue(true)
    mockRouteVideo(makeWatchVideoResult("featureFilm"))

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
    mockRouteVideo(makeWatchVideoResult("featureFilm"))

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

  it("renders an error state instead of bubbling to a 500 when route resolution throws", async () => {
    resolveWatchRouteBySlugMock.mockRejectedValue(
      new Error("Response not successful: Received status code 503"),
    )

    await render2Seg("life-of-jesus-gospel-of-john.html", "english.html")

    expect(experienceErrorMock).toHaveBeenCalledWith(
      {
        message: "Response not successful: Received status code 503",
      },
      undefined,
    )
    expect(watchPageClientMock).not.toHaveBeenCalled()
    expect(seriesPageClientMock).not.toHaveBeenCalled()
    expect(resolveWatchPageMock).not.toHaveBeenCalled()
  })
})

describe("Catch-all routing — video precedence (2-seg)", () => {
  it("renders video and skips Experience when both exist for the slug", async () => {
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
    mockRouteVideo(makeWatchVideoResult("featureFilm"))
    await render2Seg("easter", "english")
    expect(seriesPageClientMock).not.toHaveBeenCalled()
    expect(watchPageClientMock).toHaveBeenCalledTimes(1)
    expect(watchQuestionPanelMock).not.toHaveBeenCalled()
    expect(resolveWatchRouteBySlugMock).toHaveBeenCalledWith(
      "easter",
      "english",
    )
    expect(resolveWatchPageMock).not.toHaveBeenCalled()
  })

  it("renders playlist/series and skips Experience when both exist for the slug", async () => {
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
    mockRouteSeries(makeWatchVideoResult("collection"))
    await render2Seg("easter", "english")
    expect(seriesPageClientMock).toHaveBeenCalledTimes(1)
    expect(watchPageClientMock).not.toHaveBeenCalled()
    expect(watchQuestionPanelMock).not.toHaveBeenCalled()
    expect(resolveWatchPageMock).not.toHaveBeenCalled()
  })

  it("renders trailerless series fallback before same-slug Experience", async () => {
    resolveWatchPageMock.mockResolvedValue({
      data: {
        kind: "experience",
        experience: {
          id: "exp-1",
          slug: "storyclubs-no-trailer",
          title: "StoryClubs landing",
          blocks: [{ __typename: "TextBlock", id: "blk-1", text: "Hello" }],
        },
      },
      error: null,
    })
    mockRouteSeries(makeSeriesResult("storyclubs-no-trailer"))

    await render2Seg("storyclubs-no-trailer", "english")

    expect(seriesPageClientMock).toHaveBeenCalledTimes(1)
    expect(watchPageClientMock).not.toHaveBeenCalled()
    expect(resolveWatchRouteBySlugMock).toHaveBeenCalledWith(
      "storyclubs-no-trailer",
      "english",
    )
    expect(resolveWatchPageMock).not.toHaveBeenCalled()
  })

  it("renders the gated question panel for curated watch experiences when no video or series resolves", async () => {
    isWatchQuestionPanelEnabledMock.mockResolvedValue(true)
    mockRouteNone()
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
    expect(
      container.querySelector('[data-testid="watch-home-footer"]'),
    ).toBeNull()
    expect(resolveWatchRouteBySlugMock).toHaveBeenCalledWith(
      "easter",
      "english",
    )
  })

  it("falls through to ExperienceEmpty when Experience has no blocks", async () => {
    mockRouteNone()
    resolveWatchPageMock.mockResolvedValue({
      data: {
        kind: "experience",
        experience: { id: "exp-1", slug: "x", title: "X", blocks: [] },
      },
      error: null,
    })
    await render2Seg("x", "english")
    expect(experienceEmptyMock).toHaveBeenCalledTimes(1)
    expect(resolveWatchRouteBySlugMock).toHaveBeenCalledWith("x", "english")
  })
})

describe("Catch-all routing — series-without-trailer fallthrough (2-seg)", () => {
  it("renders a trailerless series when the route resolver returns one", async () => {
    mockRouteSeries(makeSeriesResult())
    await render2Seg("storyclubs-no-trailer", "english")
    expect(seriesPageClientMock).toHaveBeenCalledTimes(1)
    expect(resolveWatchRouteBySlugMock).toHaveBeenCalledWith(
      "storyclubs-no-trailer",
      "english",
    )
    expect(watchPageClientMock).not.toHaveBeenCalled()
  })

  it("404s when route resolver returns none and watchPage reports missing", async () => {
    mockRouteNone()
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
    mockRouteSeries(watchVideo)
    await render2Seg("storyclubs", "english")
    const args = seriesPageClientMock.mock.calls[0]?.[0]
    expect(args?.selectedVariant).toBe(watchVideo.selectedVariant)
    expect(args?.locale).toBe("english")
  })

  it("passes selectedVariant=null in static-mode (trailerless) series rendering", async () => {
    mockRouteSeries(makeSeriesResult())
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
    mockRouteSeries(watchVideo)
    await render2Seg("storyclubs", "spanish-castilian")
    const args = seriesPageClientMock.mock.calls[0]?.[0]
    expect(args?.locale).toBe("spanish-castilian")
  })

  it("does not redirect a series route when the optional parent variant language differs from the URL language", async () => {
    const watchVideo = makeWatchVideoResult("collection", {
      slug: "hindi",
      bcp47: "hi",
      name: "Hindi",
    })
    mockRouteSeries(watchVideo)
    await render2Seg("how-did-we-get-here-episode-1", "spanish-castilian")
    const args = seriesPageClientMock.mock.calls[0]?.[0]
    expect(redirectMock).not.toHaveBeenCalled()
    expect(args?.selectedVariant).toBe(watchVideo.selectedVariant)
    expect(args?.locale).toBe("spanish-castilian")
  })

  it("passes raw slug-form locale in static-mode (trailerless) too", async () => {
    const result = makeSeriesResult()
    result.video.childDubLanguages = [
      {
        slug: "spanish-castilian",
        bcp47: "es-ES",
        name: "Spanish, Castilian",
      },
    ]
    mockRouteSeries(result)
    await render2Seg("storyclubs-no-trailer", "spanish-castilian")
    const args = seriesPageClientMock.mock.calls[0]?.[0]
    expect(args?.locale).toBe("spanish-castilian")
  })
})

describe("Catch-all routing — .html shape acceptance (2-seg)", () => {
  it("strips .html from slug and locale params before dispatch (canonical shape)", async () => {
    mockRouteSeries(makeWatchVideoResult("collection"))
    await render2Seg("storyclubs.html", "english.html")
    expect(resolveWatchRouteBySlugMock).toHaveBeenCalledWith(
      "storyclubs",
      "english",
    )
    const args = seriesPageClientMock.mock.calls[0]?.[0]
    expect(args?.locale).toBe("english")
  })

  it("handles .html suffix with slug-form locale (spanish-castilian.html)", async () => {
    mockRouteSeries(
      makeWatchVideoResult("collection", {
        slug: "spanish-castilian",
        bcp47: "es",
        name: "Spanish, Castilian",
      }),
    )
    await render2Seg("storyclubs.html", "spanish-castilian.html")
    expect(resolveWatchRouteBySlugMock).toHaveBeenCalledWith(
      "storyclubs",
      "spanish-castilian",
    )
    const args = seriesPageClientMock.mock.calls[0]?.[0]
    expect(args?.locale).toBe("spanish-castilian")
  })

  it("still accepts bare-shape input (transitional)", async () => {
    mockRouteSeries(makeWatchVideoResult("collection"))
    await render2Seg("storyclubs", "english")
    expect(resolveWatchRouteBySlugMock).toHaveBeenCalledWith(
      "storyclubs",
      "english",
    )
  })
})

describe("Catch-all routing — slug→bcp47 family fallback for UI chrome (2-seg)", () => {
  it("renders Spanish UI chrome when URL locale is 'spanish-castilian'", async () => {
    // Non-series record so WatchPageClient receives the locale prop.
    mockRouteVideo(
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
    mockRouteVideo(
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
    mockRouteVideo(
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

  it("falls back to DEFAULT_LOCALE='en' when language family has no generated catalog", async () => {
    // Aari is a valid public audio language, but it is outside the
    // official-language inventory catalog rollout.
    mockRouteVideo(
      makeWatchVideoResult("shortFilm", {
        slug: "aari",
        bcp47: "aiw",
        name: "Aari",
      }),
    )
    await render2Seg("storyclubs.html", "aari.html")
    const props = watchPageClientMock.mock.calls[0]?.[0] as { locale?: string }
    expect(props?.locale).toBe("en")
  })
})

describe("Catch-all routing — 3-seg episode branch", () => {
  it("renders a language-less two-segment episode as contextual English", async () => {
    resolveSeriesEpisodeBySlugMock.mockResolvedValue(makeEpisodeResult())

    await renderLanguageLessEpisode(
      "lumo-the-gospel-of-john.html",
      "wedding-in-cana.html",
    )

    expect(watchPageClientMock).toHaveBeenCalledTimes(1)
    expect(resolveSeriesEpisodeBySlugMock).toHaveBeenCalledWith(
      "lumo-the-gospel-of-john",
      "wedding-in-cana",
      "english",
    )
  })

  it("renders WatchPageClient when episode + series resolve", async () => {
    resolveSeriesEpisodeBySlugMock.mockResolvedValue(makeEpisodeResult())
    await render3Seg("lumo-the-gospel-of-john", "wedding-in-cana", "english")
    expect(watchPageClientMock).toHaveBeenCalledTimes(1)
    expect(resolveSeriesEpisodeBySlugMock).toHaveBeenCalledWith(
      "lumo-the-gospel-of-john",
      "wedding-in-cana",
      "english",
    )
    expect(
      Array.from(
        container.querySelectorAll(
          '[data-testid="watch-page-client-mock"], [data-testid="watch-home-footer"]',
        ),
        (element) => element.getAttribute("data-testid"),
      ),
    ).toEqual(["watch-page-client-mock", "watch-home-footer"])
  })

  it("suppresses all JSON-LD for noIndex contextual episodes", async () => {
    const result = makeEpisodeResult()
    result.video.noIndex = true
    resolveSeriesEpisodeBySlugMock.mockResolvedValue(result)

    await render3Seg("lumo-the-gospel-of-john", "wedding-in-cana", "english")

    expect(watchPageClientMock).toHaveBeenCalledTimes(1)
    expect(
      container.querySelectorAll('script[type="application/ld+json"]'),
    ).toHaveLength(0)
  })

  it("keeps the requested parent collection for multi-parent chapter routes", async () => {
    const result = makeEpisodeResult() as unknown as {
      video: Record<string, unknown>
      canonicalParent: Record<string, unknown>
      series: Record<string, unknown>
    }
    const anticipateChildren = pilatePageChapterSlugs.map((slug, index) => ({
      documentId: `pilate-chapter-${index + 1}`,
      slug,
      title: `Pilate chapter ${index + 1}`,
      label: "clip",
      images: [],
      durationSeconds: null,
      muxPlaybackId: `mux-pilate-${index + 1}`,
    }))
    const anticipateParent = {
      documentId: "anticipate-parent",
      slug: "anticipate-the-resurrection",
      title: "Anticipate the Resurrection",
      label: "collection",
      images: [],
      children: anticipateChildren,
    }
    result.video.documentId = "pilate-chapter-20"
    result.video.slug = "jesus-is-crucified"
    result.video.title = "Jesus is Crucified"
    result.video.parents = [
      {
        documentId: "jesus-parent",
        slug: "jesus",
        title: "JESUS",
        label: "collection",
        images: [],
        children: [],
      },
      anticipateParent,
    ]
    result.canonicalParent = anticipateParent
    result.series = anticipateParent

    resolveSeriesEpisodeBySlugMock.mockResolvedValue(result)

    await render3Seg(
      "anticipate-the-resurrection",
      "jesus-is-crucified",
      "english",
    )

    expect(resolveSeriesEpisodeBySlugMock).toHaveBeenCalledWith(
      "anticipate-the-resurrection",
      "jesus-is-crucified",
      "english",
    )
    const props = watchPageClientMock.mock.calls[0]?.[0] as {
      collectionSlug?: string
      mergedBlocks?: Array<{
        kind?: string
        video?: { documentId?: string; slug?: string }
        nextWatchItem?: {
          parentSlug?: string
          slug?: string
          documentId?: string
        } | null
        canonicalParent?: {
          slug?: string | null
          title?: string | null
          children?: unknown[]
        }
        selectableParents?: unknown
        currentVideoDocumentId?: string
      }>
    }
    const carousel = props.mergedBlocks?.find(
      (block) => block.kind === "SiblingCarousel",
    )
    expect(carousel?.canonicalParent?.slug).toBe("anticipate-the-resurrection")
    expect(carousel?.canonicalParent?.title).toBe("Anticipate the Resurrection")
    expect(carousel?.canonicalParent?.children).toHaveLength(29)
    expect(carousel).not.toHaveProperty("selectableParents")
    expect(carousel?.currentVideoDocumentId).toBe("pilate-chapter-20")
    expect(
      props.mergedBlocks?.find((block) => block.kind === "HeroPlayer")
        ?.nextWatchItem,
    ).toMatchObject({
      parentSlug: "anticipate-the-resurrection",
      slug: "jesus-dies-on-the-cross",
      documentId: "pilate-chapter-21",
    })
    expect(
      props.mergedBlocks?.find((block) => block.kind === "Share")?.video,
    ).toMatchObject({
      documentId: "pilate-chapter-20",
      slug: "jesus-is-crucified",
    })
    expect(props.collectionSlug).toBe("anticipate-the-resurrection")
    expect(jsonLdByType("BreadcrumbList")).toBeNull()
    expect(jsonLdByType("VideoObject")).toMatchObject({
      url: "https://www.jesusfilm.org/watch/jesus-is-crucified.html",
      potentialAction: {
        target:
          "https://www.jesusfilm.org/watch/jesus-is-crucified.html?t={seek_to_second_number}",
      },
    })
    const relatedItems = jsonLdByType("ItemList")?.itemListElement as
      | Array<Record<string, unknown>>
      | undefined
    expect(relatedItems).toHaveLength(12)
    expect(relatedItems?.[0]).toMatchObject({
      position: 1,
      name: "Pilate chapter 1",
      url: "https://www.jesusfilm.org/watch/triumphal-entry.html",
    })
    expect(relatedItems?.at(-1)).toMatchObject({
      position: 12,
      name: "Pilate chapter 12",
    })
    expect(getWatchRouteManifestMock).not.toHaveBeenCalled()
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

  it("passes Admin-resolved episode Bible passages through the Bible Quotes block", async () => {
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

    const props = watchPageClientMock.mock.calls[0]?.[0] as {
      mergedBlocks: Array<{
        kind?: string
        passages?: Array<unknown>
      }>
    }
    expect(
      props.mergedBlocks.find((block) => block.kind === "BibleQuotes")
        ?.passages,
    ).toEqual([
      expect.objectContaining({
        content: "Server passage.",
        reference: "JHN.3.16",
      }),
    ])
  })

  it("passes the Bible Quotes hide flag to episode WatchPageClient when enabled", async () => {
    isWatchHideBibleQuotesEnabledMock.mockResolvedValue(true)
    resolveSeriesEpisodeBySlugMock.mockResolvedValue(makeEpisodeResult())

    await render3Seg(
      "lumo-the-gospel-of-john.html",
      "wedding-in-cana",
      "english.html",
    )

    expect(isWatchHideBibleQuotesEnabledMock).toHaveBeenCalledWith({
      custom: {
        route:
          "/watch/lumo-the-gospel-of-john.html/wedding-in-cana/english.html",
      },
    })
    expect(watchPageClientMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        hideBibleQuotes: true,
      }),
    )
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
    expect(resolveWatchRouteBySlugMock).not.toHaveBeenCalled()
    expect(resolveWatchPageMock).not.toHaveBeenCalled()
  })
})

/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
  bibleVideoPageClientMock,
  seriesPageClientMock,
  resolveWatchVideoBySlugMock,
  resolveSeriesBySlugMock,
  notFoundMock,
  redirectMock,
  isWatchCtaTextCopyEnabledMock,
  isWatchYouVersionBibleQuotesEnabledMock,
  isWatchHideBibleQuotesEnabledMock,
  isWatchQuestionPanelEnabledMock,
  fetchYouVersionBibleQuotePassagesMock,
  getInitialSubtitleTranscriptMock,
} = vi.hoisted(() => ({
  bibleVideoPageClientMock: vi.fn((_props: unknown) => null),
  seriesPageClientMock: vi.fn((_props: unknown) => null),
  resolveWatchVideoBySlugMock: vi.fn(),
  resolveSeriesBySlugMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
  redirectMock: vi.fn((destination: string) => {
    throw new Error(`NEXT_REDIRECT:${destination}`)
  }),
  isWatchCtaTextCopyEnabledMock: vi.fn(async () => false),
  isWatchYouVersionBibleQuotesEnabledMock: vi.fn(async () => false),
  isWatchHideBibleQuotesEnabledMock: vi.fn(async () => false),
  isWatchQuestionPanelEnabledMock: vi.fn(async () => false),
  fetchYouVersionBibleQuotePassagesMock: vi.fn(async () => []),
  getInitialSubtitleTranscriptMock: vi.fn(async () => null),
}))

vi.mock("@/lib/content", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/content")>("@/lib/content")
  return {
    ...actual,
    resolveWatchVideoBySlug: resolveWatchVideoBySlugMock,
    resolveSeriesBySlug: resolveSeriesBySlugMock,
  }
})

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
  redirect: redirectMock,
}))

vi.mock("@/components/watch/BibleVideoPageClient", () => ({
  BibleVideoPageClient: bibleVideoPageClientMock,
}))

vi.mock("@/components/watch/SeriesPageClient", () => ({
  SeriesPageClient: seriesPageClientMock,
}))

vi.mock("@/lib/feature-flags", () => ({
  isWatchCtaTextCopyEnabled: isWatchCtaTextCopyEnabledMock,
  isWatchYouVersionBibleQuotesEnabled: isWatchYouVersionBibleQuotesEnabledMock,
  isWatchHideBibleQuotesEnabled: isWatchHideBibleQuotesEnabledMock,
  isWatchQuestionPanelEnabled: isWatchQuestionPanelEnabledMock,
}))

vi.mock("@/lib/youversion-passage", () => ({
  fetchYouVersionBibleQuotePassages: fetchYouVersionBibleQuotePassagesMock,
}))

vi.mock("@/lib/watch-transcript", () => ({
  getInitialSubtitleTranscript: getInitialSubtitleTranscriptMock,
}))

import BibleVideoPage, {
  generateMetadata,
} from "@/app/[locale]/[htmlLang]/bible-video/[slugSegment]/[localeSegment]/page"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  resolveWatchVideoBySlugMock.mockReset()
  resolveSeriesBySlugMock.mockReset()
  bibleVideoPageClientMock.mockClear()
  seriesPageClientMock.mockClear()
  notFoundMock.mockClear()
  redirectMock.mockClear()
  isWatchCtaTextCopyEnabledMock.mockReset()
  isWatchCtaTextCopyEnabledMock.mockResolvedValue(false)
  isWatchYouVersionBibleQuotesEnabledMock.mockReset()
  isWatchYouVersionBibleQuotesEnabledMock.mockResolvedValue(false)
  isWatchHideBibleQuotesEnabledMock.mockReset()
  isWatchHideBibleQuotesEnabledMock.mockResolvedValue(false)
  isWatchQuestionPanelEnabledMock.mockReset()
  isWatchQuestionPanelEnabledMock.mockResolvedValue(false)
  fetchYouVersionBibleQuotePassagesMock.mockReset()
  fetchYouVersionBibleQuotePassagesMock.mockResolvedValue([])
  getInitialSubtitleTranscriptMock.mockReset()
  getInitialSubtitleTranscriptMock.mockResolvedValue(null)

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
  variantLang: { slug: string; bcp47: string; name: string } = {
    slug: "english",
    bcp47: "en",
    name: "English",
  },
) {
  const selectedVariant = {
    documentId: "var-1",
    hls: "https://cdn.example/storyclubs.m3u8",
    muxVideo: { playbackId: "pb-1" },
    language: variantLang,
    published: true,
    duration: 30,
    downloads: [],
  }

  return {
    video: {
      documentId: "video-1",
      slug: "storyclubs",
      title: "StoryClubs",
      snippet: "StoryClubs snippet",
      description: "StoryClubs description",
      noIndex: false,
      label: "featureFilm",
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

function bibleParams(
  slugSegment = "storyclubs.html",
  localeSegment = "english.html",
) {
  return Promise.resolve({
    locale: "en",
    htmlLang: "en",
    slugSegment,
    localeSegment,
  })
}

async function renderBibleVideo(
  slugSegment = "storyclubs.html",
  localeSegment = "english.html",
) {
  const element = await BibleVideoPage({
    params: bibleParams(slugSegment, localeSegment),
  })
  await act(async () => {
    root.render(element)
  })
}

describe("Bible Video page route", () => {
  it("renders the isolated Bible Video client with the resolved Watch video", async () => {
    resolveWatchVideoBySlugMock.mockResolvedValue(makeWatchVideoResult())

    await renderBibleVideo()

    expect(resolveWatchVideoBySlugMock).toHaveBeenCalledWith(
      "storyclubs",
      "english",
    )
    expect(isWatchCtaTextCopyEnabledMock).toHaveBeenCalledWith({
      custom: { route: "/watch/bible-video/storyclubs.html/english.html" },
    })
    expect(isWatchQuestionPanelEnabledMock).toHaveBeenCalledWith({
      custom: { route: "/watch/bible-video/storyclubs.html/english.html" },
    })
    expect(bibleVideoPageClientMock).toHaveBeenCalledTimes(1)
    expect(bibleVideoPageClientMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        languageSlug: "english",
        locale: "en",
        video: expect.objectContaining({ slug: "storyclubs" }),
        variant: expect.objectContaining({ documentId: "var-1" }),
      }),
    )
  })

  it("redirects selected-language mismatches back to the Bible Video prefix", async () => {
    resolveWatchVideoBySlugMock.mockResolvedValue(
      makeWatchVideoResult({
        slug: "russian",
        bcp47: "ru",
        name: "Russian",
      }),
    )

    await expect(
      BibleVideoPage({
        params: bibleParams("storyclubs.html", "english.html"),
      }),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/bible-video/storyclubs.html/russian.html?_lr=1",
    )
  })

  it("uses Bible Video URLs in video metadata", async () => {
    resolveWatchVideoBySlugMock.mockResolvedValue(makeWatchVideoResult())

    const metadata = await generateMetadata({ params: bibleParams() })

    expect(metadata.openGraph?.url).toBe(
      "https://www.jesusfilm.org/watch/bible-video/storyclubs.html/english.html",
    )
    expect(metadata.alternates?.canonical).toBe(
      "https://www.jesusfilm.org/watch/bible-video/storyclubs.html/english.html",
    )
  })

  it("404s when neither video nor series content resolves", async () => {
    resolveWatchVideoBySlugMock.mockResolvedValue(null)
    resolveSeriesBySlugMock.mockResolvedValue(null)

    await expect(BibleVideoPage({ params: bibleParams() })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    )
  })
})
